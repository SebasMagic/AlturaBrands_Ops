import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'

import { PURCHASE_ORDER_MODULE } from '../../../modules/purchase-order'
import { SUPPLY_AVAILABILITY_MODULE } from '../../../modules/supply-availability'

type Input = { order_id: string; eta_days: number }

/**
 * Convierte un pedido despachado en existencias en tránsito.
 *
 * Escribe en dos sitios, y en la misma pasada para que no puedan divergir:
 *   - `supply_availability` como IN_TRANSIT: fuente de verdad, con origen y ETA.
 *   - `inventory_level.incoming_quantity`: proyección de lectura, para que el
 *     admin de Medusa muestre lo que viene en camino.
 *
 * Usa `quantity_confirmed`, no `quantity_requested`: lo que viaja es lo que la
 * marca confirmó, no lo que se pidió. Confundirlos infla el tránsito con
 * unidades que nunca se despacharon.
 */
export const createTransitStockStep = createStep(
  'create-transit-stock-from-purchase-order',
  async ({ order_id, eta_days }: Input, { container }) => {
    const orderService: any = container.resolve(PURCHASE_ORDER_MODULE)
    const supplyService: any = container.resolve(SUPPLY_AVAILABILITY_MODULE)
    const inventoryService = container.resolve(Modules.INVENTORY)
    const stockLocationService = container.resolve(Modules.STOCK_LOCATION)

    const order = await orderService.retrievePurchaseOrder(order_id, {
      relations: ['items', 'items.sizes'],
    })

    const source = `Pedido ${order.code}`
    const filas: any[] = []

    for (const item of order.items ?? []) {
      for (const size of item.sizes ?? []) {
        const cantidad = size.quantity_confirmed ?? 0
        if (cantidad > 0) {
          filas.push({
            operation_code: order.operation_code,
            material_code: item.material_code,
            sku: size.sku,
            source,
            kind: 'IN_TRANSIT',
            eta_days,
            quantity: cantidad,
          })
        }
      }
    }

    if (filas.length === 0) {
      return new StepResponse(
        { created: 0, levels_updated: 0, levels_created: 0 },
        null
      )
    }

    const creadas = await supplyService.createSupplyAvailabilities(filas)

    // --- Proyección a incoming_quantity -----------------------------------
    const [bodega] = await stockLocationService.listStockLocations({
      name: 'Bodega Matriz',
    })

    // El nivel se identifica por (inventory_item_id, location_id), no por su
    // id: es así como lo direcciona el módulo de inventario.
    const nivelesTocados: {
      inventory_item_id: string
      location_id: string
      previous: number
    }[] = []
    const nivelesCreados: string[] = []

    if (bodega) {
      const porSku = new Map<string, number>()
      filas.forEach((f) => porSku.set(f.sku, (porSku.get(f.sku) ?? 0) + f.quantity))

      const items = await inventoryService.listInventoryItems(
        { sku: [...porSku.keys()] },
        { select: ['id', 'sku'] }
      )
      const skuByItem = new Map<string, string>(
        items.map((i: any) => [i.id as string, i.sku as string])
      )

      const niveles = await inventoryService.listInventoryLevels(
        { location_id: bodega.id, inventory_item_id: [...skuByItem.keys()] },
        { select: ['inventory_item_id', 'location_id', 'incoming_quantity'] }
      )
      const conNivel = new Set(niveles.map((n: any) => n.inventory_item_id))

      // Actualizar los que ya tienen nivel
      for (const nivel of niveles as any[]) {
        const sku = skuByItem.get(nivel.inventory_item_id)
        const suma = sku ? (porSku.get(sku) ?? 0) : 0
        if (!suma) continue
        const previo = Number(nivel.incoming_quantity ?? 0)
        nivelesTocados.push({
          inventory_item_id: nivel.inventory_item_id,
          location_id: nivel.location_id,
          previous: previo,
        })
        await inventoryService.updateInventoryLevels([
          {
            inventory_item_id: nivel.inventory_item_id,
            location_id: nivel.location_id,
            incoming_quantity: previo + suma,
          },
        ])
      }

      /**
       * Crear nivel donde no lo había.
       *
       * Una variante que nunca tuvo existencias en la bodega no tiene nivel, y
       * limitarse a actualizar los existentes dejaba la proyección corta: el
       * detalle decía una cosa y el admin mostraba otra. `stocked_quantity` va
       * en cero a propósito — la mercancía todavía no ha llegado.
       */
      const sinNivel = [...skuByItem.entries()].filter(([id]) => !conNivel.has(id))
      if (sinNivel.length) {
        const nuevos = await inventoryService.createInventoryLevels(
          sinNivel.map(([itemId, sku]) => ({
            inventory_item_id: itemId,
            location_id: bodega.id,
            stocked_quantity: 0,
            incoming_quantity: porSku.get(sku) ?? 0,
          }))
        )
        nivelesCreados.push(...nuevos.map((n: any) => n.id))
      }
    }

    return new StepResponse(
      {
        created: creadas.length,
        levels_updated: nivelesTocados.length,
        levels_created: nivelesCreados.length,
      },
      {
        supply_ids: creadas.map((c: any) => c.id),
        levels: nivelesTocados,
        created_levels: nivelesCreados,
      }
    )
  },
  async (compensacion, { container }) => {
    if (!compensacion) return
    const supplyService: any = container.resolve(SUPPLY_AVAILABILITY_MODULE)
    const inventoryService = container.resolve(Modules.INVENTORY)

    // Se revierte en orden inverso: primero los niveles a su valor exacto
    // anterior (no restando, que acumularía error si algo cambió en medio),
    // y después se borran las filas de disponibilidad.
    for (const nivel of compensacion.levels ?? []) {
      await inventoryService.updateInventoryLevels([
        {
          inventory_item_id: nivel.inventory_item_id,
          location_id: nivel.location_id,
          incoming_quantity: nivel.previous,
        },
      ])
    }
    // Los niveles creados por este paso se eliminan; los preexistentes solo se
    // devuelven a su valor anterior.
    if (compensacion.created_levels?.length) {
      await inventoryService.deleteInventoryLevels(compensacion.created_levels)
    }
    if (compensacion.supply_ids?.length) {
      await supplyService.deleteSupplyAvailabilities(compensacion.supply_ids)
    }
  }
)
