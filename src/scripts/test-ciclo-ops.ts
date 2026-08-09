import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

import { GOODS_RECEIPT_MODULE } from '../modules/goods-receipt'
import { PURCHASE_ORDER_MODULE } from '../modules/purchase-order'
import { STOCK_LEDGER_MODULE } from '../modules/stock-ledger'
import { SUPPLY_AVAILABILITY_MODULE } from '../modules/supply-availability'
import { confirmGoodsReceiptWorkflow } from '../workflows/goods-receipt'
import {
  approvePurchaseOrderWorkflow,
  checkQuantitiesWorkflow,
  createPurchaseOrderWorkflow,
  dispatchPurchaseOrderWorkflow,
} from '../workflows/purchase-order'

/**
 * Recorre el ciclo OPS entero y verifica los saldos en cada salto:
 *
 *   por pedir → pedido → despachado → EN TRANSITO → recibido → EN BODEGA
 *
 * Es la prueba de que el ciclo cierra. Antes de la recepcion se rompia justo
 * en el medio: lo comprado nunca llegaba a ser vendible.
 *
 *   pnpm exec medusa exec ./src/scripts/test-ciclo-ops.ts
 */

const OPERACION = 'CO'
const MARCA = 'KEEN'

export default async function testCicloOps({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const poService: any = container.resolve(PURCHASE_ORDER_MODULE)
  const grService: any = container.resolve(GOODS_RECEIPT_MODULE)
  const ledgerService: any = container.resolve(STOCK_LEDGER_MODULE)
  const supplyService: any = container.resolve(SUPPLY_AVAILABILITY_MODULE)
  const inventoryService = container.resolve(Modules.INVENTORY)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const productService = container.resolve(Modules.PRODUCT)

  const linea = (t: string) =>
    logger.info(`\n${'-'.repeat(64)}\n${t}\n${'-'.repeat(64)}`)

  const [bodega] = await stockLocationService.listStockLocations({
    name: 'Bodega Matriz',
  })
  if (!bodega) throw new Error('No existe Bodega Matriz.')

  const saldos = async (skus: string[]) => {
    const items = await inventoryService.listInventoryItems(
      { sku: skus },
      { select: ['id', 'sku'] }
    )
    const porItem = new Map(items.map((i: any) => [i.id, i.sku]))
    const niveles = await inventoryService.listInventoryLevels(
      { location_id: bodega.id, inventory_item_id: items.map((i: any) => i.id) },
      { select: ['inventory_item_id', 'stocked_quantity', 'incoming_quantity'] }
    )
    let bodegaTotal = 0
    let camino = 0
    niveles.forEach((n: any) => {
      bodegaTotal += Number(n.stocked_quantity ?? 0)
      camino += Number(n.incoming_quantity ?? 0)
    })
    const transito = await supplyService.listSupplyAvailabilities(
      { kind: 'IN_TRANSIT', sku: skus },
      { select: ['quantity'] }
    )
    return {
      bodega: bodegaTotal,
      camino,
      transito: transito.reduce((a: number, s: any) => a + Number(s.quantity), 0),
    }
  }

  // --- Elegir material con disponibilidad en la marca ---------------------
  const disponibles = await supplyService.listSupplyAvailabilities(
    { kind: 'SUPPLIER' },
    { select: ['sku', 'material_code', 'quantity'], take: 400 }
  )
  const porMaterial = new Map<string, any[]>()
  disponibles.forEach((d: any) => {
    if (!porMaterial.has(d.material_code)) porMaterial.set(d.material_code, [])
    porMaterial.get(d.material_code)!.push(d)
  })
  const elegido = [...porMaterial.entries()].find(([, v]) => v.length >= 3)
  if (!elegido) throw new Error('No hay material con suficientes tallas disponibles.')
  const [material, filas] = elegido
  const muestra = filas.slice(0, 3)
  const skus = muestra.map((f: any) => f.sku)

  const [variante] = await productService.listProductVariants(
    { sku: [skus[0]] },
    { select: ['id', 'sku', 'title'] }
  )

  linea(`Material ${material} · tallas ${skus.join(', ')}`)
  const inicio = await saldos(skus)
  logger.info(
    `  ANTES  bodega=${inicio.bodega}  incoming=${inicio.camino}  transito=${inicio.transito}`
  )

  // --- 1. Crear el pedido -------------------------------------------------
  linea('1. POR PEDIR -> PEDIDO')
  const { result: pedido } = await createPurchaseOrderWorkflow(container).run({
    input: {
      operation_code: OPERACION,
      brand_code: MARCA,
      currency_code: 'usd',
      notes: 'Prueba del ciclo OPS completo',
      items: [
        {
          material_code: material,
          description: variante?.title ?? `MATERIAL ${material}`,
          size_curve_code: null,
          packs: 1,
          is_adjusted: false,
          adjustment_note: null,
          unit_cost_cents: 3500,
          sizes: muestra.map((f: any) => ({
            sku: f.sku,
            size_label: String(f.sku).split('-')[1] ?? f.sku,
            size_value: 0,
            quantity_requested: 4,
          })),
        },
      ],
    },
  })
  const orden: any = pedido
  logger.info(`  pedido ${orden.code} creado con ${orden.items} item(s), ${orden.pares} pares`)

  // --- 2. La marca confirma cantidades -----------------------------------
  linea('2. PEDIDO -> CANTIDAD AJUSTADA')
  const full = await poService.retrievePurchaseOrder(orden.id, {
    relations: ['items', 'items.sizes'],
  })
  let confirmado = 0
  for (const item of full.items) {
    for (const [i, size] of item.sizes.entries()) {
      // La marca recorta la primera talla: el caso real de faltante.
      const cant = i === 0 ? 3 : size.quantity_requested
      confirmado += cant
      await poService.updatePurchaseOrderSizes({ id: size.id, quantity_confirmed: cant })
    }
  }
  await checkQuantitiesWorkflow(container).run({ input: { order_id: orden.id } })
  logger.info(`  pedido 12 pares · confirmado ${confirmado} pares`)

  // --- 3. Aprobacion y despacho ------------------------------------------
  linea('3. APROBACION -> DESPACHO -> EN TRANSITO')
  await approvePurchaseOrderWorkflow(container).run({ input: { order_id: orden.id } })
  await dispatchPurchaseOrderWorkflow(container).run({
    input: { order_id: orden.id, dispatch_ticket: 'CICLO-OPS-001', eta_days: 30 },
  })
  const trasDespacho = await saldos(skus)
  logger.info(
    `  bodega=${trasDespacho.bodega}  incoming=${trasDespacho.camino}  transito=${trasDespacho.transito}`
  )
  const okTransito = trasDespacho.transito - inicio.transito === confirmado
  logger.info(
    `  transito subio ${trasDespacho.transito - inicio.transito}  ` +
      `${okTransito ? 'OK' : `ESPERADO ${confirmado} <-- REVISAR`}`
  )

  // --- 4. Recepcion -------------------------------------------------------
  linea('4. LLEGA EL CONTENEDOR -> RECEPCION')
  const previas = await grService.listGoodsReceipts({}, { select: ['id'] })
  const recepcion = await grService.createGoodsReceipts({
    code: `GR-${OPERACION}-${String(previas.length + 1).padStart(4, '0')}`,
    operation_code: OPERACION,
    purchase_order_code: orden.code,
    warehouse_id: bodega.id,
    status: 'DRAFT',
    reference: 'CONTENEDOR-DEMO-001',
    received_at: new Date(),
    received_by: 'prueba automatica',
  })

  // Se relee: `full` se capturo antes de confirmar cantidades y trae los
  // quantity_confirmed en nulo.
  const ordenConfirmada = await poService.retrievePurchaseOrder(orden.id, {
    relations: ['items', 'items.sizes'],
  })

  // Se recibe todo salvo una unidad de la ultima talla: faltante real.
  const recibidas: Record<string, number> = {}
  const tallas = ordenConfirmada.items[0].sizes
  const lineasRecepcion = tallas.map((s: any, i: number) => {
    const esperado = Number(s.quantity_confirmed)
    const recibido = i === tallas.length - 1 ? esperado - 1 : esperado
    recibidas[s.sku] = recibido
    return {
      sku: s.sku,
      material_code: material,
      size_label: s.size_label,
      quantity_expected: esperado,
      quantity_received: recibido,
      discrepancy_note: recibido !== esperado ? 'Faltante en el conteo fisico' : null,
      receipt_id: recepcion.id,
    }
  })
  await grService.createGoodsReceiptLines(lineasRecepcion)

  const totalRecibido = Object.values(recibidas).reduce((a, b) => a + b, 0)
  logger.info(`  recepcion ${recepcion.code} en DRAFT · ${totalRecibido} pares contados`)

  const { result: aplicado } = await confirmGoodsReceiptWorkflow(container).run({
    input: { receipt_id: recepcion.id },
  })
  const r: any = aplicado
  logger.info(
    `  confirmada: ${r.skus} SKUs · ${r.unidades} unidades · ` +
      `${r.movimientos} movimientos de kardex`
  )

  // --- 5. Verificacion ----------------------------------------------------
  linea('5. VERIFICACION')
  const fin = await saldos(skus)
  const ok = (a: number, b: number) => (a === b ? 'OK' : `ESPERADO ${b} <-- REVISAR`)

  logger.info(`  bodega   ${inicio.bodega} -> ${fin.bodega}   ${ok(fin.bodega - inicio.bodega, totalRecibido)}`)
  logger.info(`  transito ${trasDespacho.transito} -> ${fin.transito}   ${ok(trasDespacho.transito - fin.transito, totalRecibido)}`)

  const movs = await ledgerService.listStockMoves(
    { reference_id: recepcion.code },
    { select: ['sku', 'quantity', 'kind', 'balance_after'] }
  )
  const sumaKardex = movs.reduce((a: number, m: any) => a + Number(m.quantity), 0)
  logger.info(`  kardex   ${movs.length} movimientos, ${sumaKardex} unidades   ${ok(sumaKardex, totalRecibido)}`)
  movs.forEach((m: any) =>
    logger.info(`    ${m.kind}  ${String(m.sku).padEnd(16)} +${m.quantity}  saldo=${m.balance_after}`)
  )

  const rec = await grService.retrieveGoodsReceipt(recepcion.id)
  logger.info(`  recepcion estado=${rec.status} confirmada=${rec.confirmed_at ? 'si' : 'NO'}`)

  linea('6. LA GUARDA: no se puede confirmar dos veces')
  try {
    await confirmGoodsReceiptWorkflow(container).run({ input: { receipt_id: recepcion.id } })
    logger.error('  FALLO: permitio confirmar dos veces')
  } catch (e: any) {
    logger.info(`  OK, rechazado: ${String(e.message).split('\n')[0]}`)
  }
}
