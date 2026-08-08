import fs from 'node:fs'
import path from 'node:path'

import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  createInventoryLevelsWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/medusa/core-flows'

import { SUPPLY_AVAILABILITY_MODULE } from '../modules/supply-availability'

/**
 * Carga existencias y disponibilidad (pasos 5 y 6).
 *
 * Los dos pasos van en el MISMO script a propósito. Las unidades en tránsito
 * se escriben en dos sitios:
 *
 *   - `supply_availability`  -> fuente de verdad, con origen y ETA por fila.
 *   - `inventory_level.incoming_quantity` -> proyección de lectura, para que
 *     el admin de Medusa muestre lo que viene en camino.
 *
 * Al escribirse en una sola pasada desde el mismo JSON, no pueden divergir.
 * Si algún día hay que corregir un tránsito, se corrige en el maestro y se
 * vuelve a cargar; nunca editando `incoming_quantity` a mano.
 *
 * Solo Bodega Matriz es un `stock_location` real. ATS USA no lo es, y por eso
 * sus 113.447 pares no pueden reservarse ni despacharse.
 *
 *   pnpm exec medusa exec ./src/scripts/load-inventory.ts
 */

// Operación a la que pertenece esta carga. Al añadir países, este script se
// parametriza por operación en vez de duplicarse.
const OPERATION_CODE = 'CO'
const WAREHOUSE_NAME = 'Bodega Matriz'
const BATCH = 500

type Existencia = {
  origen: string
  tipo: 'OWNED' | 'IN_TRANSIT' | 'SUPPLIER'
  eta_dias: number | null
  unidades: number
}

type Variante = {
  sku: string
  existencias: Record<string, Existencia>
}

type Producto = { material: number; variantes: Variante[] }

const chunk = <T,>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  )

export default async function loadInventory({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const productService = container.resolve(Modules.PRODUCT)
  const inventoryService = container.resolve(Modules.INVENTORY)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const supplyService: any = container.resolve(SUPPLY_AVAILABILITY_MODULE)

  const jsonPath = path.join(process.cwd(), 'data', 'master-data.json')
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  if (!data.meta.cuadre_ok) {
    throw new Error('El JSON no cuadra contra el Excel. Se aborta la carga.')
  }
  const productos: Producto[] = data.productos

  // --- 1. Bodega ---------------------------------------------------------
  let [warehouse] = await stockLocationService.listStockLocations({
    name: WAREHOUSE_NAME,
  })
  if (!warehouse) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: { locations: [{ name: WAREHOUSE_NAME }] },
    })
    warehouse = result[0]
    logger.info(`Bodega creada: ${warehouse.name}`)

    const [channel] = await salesChannelService.listSalesChannels({})
    if (channel) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: warehouse.id, add: [channel.id] },
      })
      logger.info(`Bodega enlazada al canal: ${channel.name}`)
    }
  } else {
    logger.info(`Bodega ya existente: ${warehouse.name}`)
  }

  // --- 2. Mapas sku -> item de inventario y sku -> variante ---------------
  const items = await inventoryService.listInventoryItems({}, { select: ['id', 'sku'] })
  const itemBySku = new Map<string, string>(
    items.filter((i: any) => i.sku).map((i: any) => [i.sku as string, i.id as string])
  )
  const variants = await productService.listProductVariants({}, { select: ['id', 'sku'] })
  const variantBySku = new Map<string, string>(
    variants.filter((v: any) => v.sku).map((v: any) => [v.sku as string, v.id as string])
  )
  logger.info(`Items de inventario: ${itemBySku.size} · Variantes: ${variantBySku.size}`)

  // --- 3. Agregar el JSON por SKU ----------------------------------------
  const owned = new Map<string, number>()
  const incoming = new Map<string, number>()
  const supplyRows: {
    operation_code: string
    material_code: string
    sku: string
    source: string
    kind: 'SUPPLIER' | 'IN_TRANSIT'
    eta_days: number | null
    quantity: number
  }[] = []

  let sinMapear = 0
  for (const p of productos) {
    for (const v of p.variantes) {
      if (!itemBySku.has(v.sku)) {
        sinMapear++
        continue
      }
      for (const e of Object.values(v.existencias)) {
        if (e.tipo === 'OWNED') {
          owned.set(v.sku, (owned.get(v.sku) ?? 0) + e.unidades)
        } else {
          if (e.tipo === 'IN_TRANSIT') {
            incoming.set(v.sku, (incoming.get(v.sku) ?? 0) + e.unidades)
          }
          supplyRows.push({
            operation_code: OPERATION_CODE,
            material_code: String(p.material),
            sku: v.sku,
            source: e.origen,
            kind: e.tipo,
            eta_days: e.eta_dias,
            quantity: e.unidades,
          })
        }
      }
    }
  }
  if (sinMapear > 0) {
    throw new Error(
      `${sinMapear} variantes del JSON no tienen item de inventario. ` +
        'Carga el catálogo primero: load-catalog.ts'
    )
  }

  const totalOwned = [...owned.values()].reduce((a, b) => a + b, 0)
  const totalIncoming = [...incoming.values()].reduce((a, b) => a + b, 0)
  const totalSupplier = supplyRows
    .filter((r) => r.kind === 'SUPPLIER')
    .reduce((a, r) => a + r.quantity, 0)

  logger.info(
    `A cargar -> propio: ${totalOwned} · en tránsito: ${totalIncoming} · ` +
      `proveedor: ${totalSupplier}`
  )

  // --- 4. Niveles de existencias -----------------------------------------
  // Solo se crea nivel donde hay algo. Una variante sin nivel es una variante
  // que no tenemos: eso es exactamente lo que queremos que vea el vendedor.
  const skusConNivel = new Set([...owned.keys(), ...incoming.keys()])
  const existingLevels = await inventoryService.listInventoryLevels(
    { location_id: warehouse.id },
    { select: ['id', 'inventory_item_id'] }
  )
  const yaConNivel = new Set(existingLevels.map((l: any) => l.inventory_item_id))

  const levelsInput = [...skusConNivel]
    .filter((sku) => !yaConNivel.has(itemBySku.get(sku)!))
    .map((sku) => ({
      inventory_item_id: itemBySku.get(sku)!,
      location_id: warehouse.id,
      stocked_quantity: owned.get(sku) ?? 0,
      incoming_quantity: incoming.get(sku) ?? 0,
    }))

  if (levelsInput.length === 0) {
    logger.info('Niveles de existencias: ya estaban creados, no se toca nada.')
  } else {
    for (const lote of chunk(levelsInput, BATCH)) {
      await createInventoryLevelsWorkflow(container).run({
        input: { inventory_levels: lote },
      })
    }
    logger.info(`Niveles de existencias creados: ${levelsInput.length}`)
  }

  // --- 5. Disponibilidad de proveedor y tránsito -------------------------
  const yaCargado = await supplyService.listSupplyAvailabilities(
    {},
    { select: ['id'] }
  )
  if (yaCargado.length > 0) {
    logger.info(
      `supply_availability ya tiene ${yaCargado.length} filas. Se omite la carga. ` +
        'Para recargar, purga primero esa tabla.'
    )
  } else {
    let creadas = 0
    for (const lote of chunk(supplyRows, BATCH)) {
      const rows = await supplyService.createSupplyAvailabilities(lote)
      await link.create(
        rows.map((r: any) => ({
          [Modules.PRODUCT]: { product_variant_id: variantBySku.get(r.sku)! },
          [SUPPLY_AVAILABILITY_MODULE]: { supply_availability_id: r.id },
        }))
      )
      creadas += rows.length
      logger.info(`  disponibilidad: ${creadas}/${supplyRows.length}`)
    }
    logger.info(`Filas de disponibilidad creadas y enlazadas: ${creadas}`)
  }

  // --- 6. Verificación ---------------------------------------------------
  const levels = await inventoryService.listInventoryLevels(
    { location_id: warehouse.id },
    { select: ['stocked_quantity', 'incoming_quantity'] }
  )
  const sumStocked = levels.reduce((a: number, l: any) => a + Number(l.stocked_quantity), 0)
  const sumIncoming = levels.reduce((a: number, l: any) => a + Number(l.incoming_quantity), 0)
  const supply = await supplyService.listSupplyAvailabilities({}, { select: ['kind', 'quantity'] })
  const sumSupplier = supply
    .filter((s: any) => s.kind === 'SUPPLIER')
    .reduce((a: number, s: any) => a + Number(s.quantity), 0)
  const sumTransit = supply
    .filter((s: any) => s.kind === 'IN_TRANSIT')
    .reduce((a: number, s: any) => a + Number(s.quantity), 0)

  const ok = (a: number, b: number) => (a === b ? 'OK' : `ESPERADO ${b}  <-- REVISAR`)

  logger.info('')
  logger.info('--- Verificación ---')
  logger.info(`Niveles creados          : ${levels.length}`)
  logger.info(`Propio (stocked)         : ${sumStocked}  ${ok(sumStocked, totalOwned)}`)
  logger.info(`En tránsito (incoming)   : ${sumIncoming}  ${ok(sumIncoming, totalIncoming)}`)
  logger.info(`En tránsito (detalle)    : ${sumTransit}  ${ok(sumTransit, totalIncoming)}`)
  logger.info(`Proveedor (no vendible)  : ${sumSupplier}  ${ok(sumSupplier, totalSupplier)}`)
  logger.info(
    `TOTAL                    : ${sumStocked + sumTransit + sumSupplier}  ` +
      `${ok(sumStocked + sumTransit + sumSupplier, data.meta.unidades_total)}`
  )
}
