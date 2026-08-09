import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

import { PURCHASE_ORDER_MODULE } from '../modules/purchase-order'
import { SUPPLY_AVAILABILITY_MODULE } from '../modules/supply-availability'

/**
 * Deshace todo lo que generaron los pedidos y recalcula la proyección.
 *
 * `incoming_quantity` se RECALCULA desde el detalle en vez de restarse: restar
 * acumula error si algo cambió en medio, mientras que recalcular converge
 * siempre al valor correcto. El detalle es la fuente de verdad.
 *
 *   pnpm exec medusa exec ./src/scripts/reset-purchase-orders.ts
 */

export default async function resetPurchaseOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderService: any = container.resolve(PURCHASE_ORDER_MODULE)
  const supplyService: any = container.resolve(SUPPLY_AVAILABILITY_MODULE)
  const inventoryService = container.resolve(Modules.INVENTORY)

  // --- Borrar la disponibilidad originada por pedidos ---------------------
  const todas = await supplyService.listSupplyAvailabilities(
    { kind: 'IN_TRANSIT' },
    { select: ['id', 'sku', 'source', 'quantity'] }
  )
  const dePedidos = todas.filter((s: any) => String(s.source).startsWith('Pedido '))
  if (dePedidos.length) {
    await supplyService.deleteSupplyAvailabilities(dePedidos.map((s: any) => s.id))
    logger.info(`Filas de tránsito originadas por pedidos, borradas: ${dePedidos.length}`)
  } else {
    logger.info('No había filas de tránsito originadas por pedidos.')
  }

  // --- Recalcular la proyección desde el detalle --------------------------
  const restantes = await supplyService.listSupplyAvailabilities(
    { kind: 'IN_TRANSIT' },
    { select: ['sku', 'quantity'] }
  )
  const esperado = new Map<string, number>()
  restantes.forEach((s: any) =>
    esperado.set(s.sku, (esperado.get(s.sku) ?? 0) + Number(s.quantity))
  )

  const niveles = await inventoryService.listInventoryLevels(
    {},
    { select: ['inventory_item_id', 'location_id', 'incoming_quantity'] }
  )
  const items = await inventoryService.listInventoryItems({}, { select: ['id', 'sku'] })
  const skuByItem = new Map<string, string>(
    items.map((i: any) => [i.id as string, i.sku as string])
  )

  let corregidos = 0
  for (const n of niveles as any[]) {
    const sku = skuByItem.get(n.inventory_item_id)
    const debe = sku ? (esperado.get(sku) ?? 0) : 0
    if (Number(n.incoming_quantity ?? 0) !== debe) {
      await inventoryService.updateInventoryLevels([
        {
          inventory_item_id: n.inventory_item_id,
          location_id: n.location_id,
          incoming_quantity: debe,
        },
      ])
      corregidos++
    }
  }
  logger.info(`Niveles con incoming recalculado: ${corregidos}`)

  // --- Borrar los pedidos -------------------------------------------------
  // De la hoja hacia la raíz: borrar la cabecera con hijos vivos deja
  // referencias colgando y MikroORM lo rechaza.
  const pedidos = await orderService.listPurchaseOrders({}, { select: ['id', 'code'] })
  if (pedidos.length) {
    const tallas = await orderService.listPurchaseOrderSizes({}, { select: ['id'] })
    if (tallas.length) {
      await orderService.deletePurchaseOrderSizes(tallas.map((t: any) => t.id))
    }
    const items = await orderService.listPurchaseOrderItems({}, { select: ['id'] })
    if (items.length) {
      await orderService.deletePurchaseOrderItems(items.map((i: any) => i.id))
    }
    await orderService.deletePurchaseOrders(pedidos.map((p: any) => p.id))
    logger.info(
      `Pedidos borrados: ${pedidos.map((p: any) => p.code).join(', ')} ` +
        `(${items.length} ítems, ${tallas.length} tallas)`
    )
  }

  // --- Verificación -------------------------------------------------------
  const detalle = restantes.reduce((a: number, s: any) => a + Number(s.quantity), 0)
  const nivelesFin = await inventoryService.listInventoryLevels(
    {},
    { select: ['incoming_quantity'] }
  )
  const proyeccion = nivelesFin.reduce(
    (a: number, n: any) => a + Number(n.incoming_quantity ?? 0),
    0
  )
  logger.info('')
  logger.info(`detalle tránsito : ${detalle}`)
  logger.info(
    `proyección admin : ${proyeccion}  ${proyeccion === detalle ? 'OK' : 'DIVERGE <-- REVISAR'}`
  )
}
