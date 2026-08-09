import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

import { PURCHASE_ORDER_MODULE } from '../modules/purchase-order'
import { SUPPLY_AVAILABILITY_MODULE } from '../modules/supply-availability'
import {
  approvePurchaseOrderWorkflow,
  checkQuantitiesWorkflow,
  dispatchPurchaseOrderWorkflow,
} from '../workflows/purchase-order'

/**
 * Recorre el ciclo completo de un pedido y verifica los efectos reales.
 *
 * Comprueba tanto lo que debe pasar como lo que NO debe pasar: una máquina de
 * estados que solo se prueba por el camino feliz no está probada.
 *
 *   pnpm exec medusa exec ./src/scripts/test-purchase-order-flow.ts
 */

const ETA_DIAS = 60

export default async function testFlow({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(PURCHASE_ORDER_MODULE)
  const supplyService: any = container.resolve(SUPPLY_AVAILABILITY_MODULE)
  const inventoryService = container.resolve(Modules.INVENTORY)

  const [order] = await service.listPurchaseOrders(
    { status: 'DRAFT' },
    { select: ['id', 'code', 'status'], take: 1 }
  )
  if (!order) {
    throw new Error('No hay ningún pedido en DRAFT. Importa uno primero.')
  }
  logger.info(`Pedido: ${order.code} (${order.status})`)

  const linea = (t: string) => logger.info(`\n${'-'.repeat(60)}\n${t}\n${'-'.repeat(60)}`)

  // --- Guarda: no se puede saltar de DRAFT a DISPATCHED ------------------
  linea('1. La guarda debe rechazar un salto ilegal')
  try {
    await dispatchPurchaseOrderWorkflow(container).run({
      input: { order_id: order.id, dispatch_ticket: 'ILEGAL', eta_days: ETA_DIAS },
    })
    logger.error('  FALLO: permitió saltar de DRAFT a DISPATCHED')
  } catch (e: any) {
    logger.info(`  OK, rechazado: ${String(e.message).split('\n')[0]}`)
  }

  // --- La marca confirma cantidades --------------------------------------
  linea('2. La marca revisa y ajusta cantidades')
  const full = await service.retrievePurchaseOrder(order.id, {
    relations: ['items', 'items.sizes'],
  })

  let pedido = 0
  let confirmado = 0
  let recortadas = 0
  for (const item of full.items) {
    for (const size of item.sizes) {
      pedido += size.quantity_requested
      // Simula faltantes: la marca recorta la primera talla de cada ítem,
      // que es lo que refleja la columna `Faltante pares (stock ATS)`.
      const esPrimera = item.sizes[0].id === size.id
      const cantidad = esPrimera
        ? Math.max(0, size.quantity_requested - 1)
        : size.quantity_requested
      if (cantidad !== size.quantity_requested) recortadas++
      confirmado += cantidad
      await service.updatePurchaseOrderSizes({
        id: size.id,
        quantity_confirmed: cantidad,
      })
    }
  }
  logger.info(`  pedido: ${pedido} · confirmado: ${confirmado} · recortes: ${recortadas}`)

  await checkQuantitiesWorkflow(container).run({ input: { order_id: order.id } })
  logger.info('  estado -> QTY_CHECKED')

  // --- Aprobación --------------------------------------------------------
  linea('3. Aprobación del cliente')
  await approvePurchaseOrderWorkflow(container).run({ input: { order_id: order.id } })
  logger.info('  estado -> CLIENT_APPROVED')

  // --- Despacho ----------------------------------------------------------
  linea('4. Despacho: debe generar existencias en tránsito')
  const transitoAntes = await supplyService.listSupplyAvailabilities(
    { kind: 'IN_TRANSIT' },
    { select: ['id', 'quantity'] }
  )
  const sumaAntes = transitoAntes.reduce(
    (a: number, s: any) => a + Number(s.quantity),
    0
  )

  const { result } = await dispatchPurchaseOrderWorkflow(container).run({
    input: {
      order_id: order.id,
      dispatch_ticket: 'KEEN-DSP-0001',
      eta_days: ETA_DIAS,
    },
  })
  logger.info(`  filas de tránsito creadas: ${(result as any).created}`)
  logger.info(`  niveles actualizados: ${(result as any).levels_updated}`)
  logger.info(`  niveles creados: ${(result as any).levels_created}`)

  // --- Verificación ------------------------------------------------------
  linea('5. Verificación')
  const final = await service.retrievePurchaseOrder(order.id)
  const transitoDespues = await supplyService.listSupplyAvailabilities(
    { kind: 'IN_TRANSIT' },
    { select: ['id', 'quantity'] }
  )
  const sumaDespues = transitoDespues.reduce(
    (a: number, s: any) => a + Number(s.quantity),
    0
  )
  const delta = sumaDespues - sumaAntes

  const ok = (a: number, b: number) => (a === b ? 'OK' : `ESPERADO ${b}  <-- REVISAR`)

  logger.info(`  estado final     : ${final.status}`)
  logger.info(`  ticket           : ${final.dispatch_ticket}`)
  logger.info(`  despachado_at    : ${final.dispatched_at ? 'sellado' : 'FALTA'}`)
  logger.info(`  tránsito antes   : ${sumaAntes}`)
  logger.info(`  tránsito después : ${sumaDespues}`)
  logger.info(`  incremento       : ${delta}  ${ok(delta, confirmado)}`)

  // La proyección debe coincidir exactamente con el detalle: si divergen, el
  // admin muestra una cifra y BI otra, que es peor que no mostrar nada.
  const niveles = await inventoryService.listInventoryLevels(
    {},
    { select: ['incoming_quantity'] }
  )
  const proyeccion = niveles.reduce(
    (a: number, n: any) => a + Number(n.incoming_quantity ?? 0),
    0
  )
  logger.info(`  detalle tránsito : ${sumaDespues}`)
  logger.info(`  proyección admin : ${proyeccion}  ${ok(proyeccion, sumaDespues)}`)

  const leadTime =
    final.dispatched_at && final.placed_at
      ? (new Date(final.dispatched_at).getTime() -
          new Date(final.placed_at).getTime()) /
        1000
      : null
  logger.info(`  lead time medido : ${leadTime?.toFixed(1) ?? '?'} segundos (demo)`)

  // --- La guarda tambien cierra el ciclo ---------------------------------
  linea('6. Un pedido despachado ya no admite transiciones')
  try {
    await approvePurchaseOrderWorkflow(container).run({ input: { order_id: order.id } })
    logger.error('  FALLO: permitió re-aprobar un pedido despachado')
  } catch (e: any) {
    logger.info(`  OK, rechazado: ${String(e.message).split('\n')[0]}`)
  }
}
