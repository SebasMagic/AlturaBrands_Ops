import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'

import { PURCHASE_ORDER_MODULE } from '../../../modules/purchase-order'
import type { PurchaseOrderStatus } from './validate-transition'

type Input = {
  order_id: string
  status: PurchaseOrderStatus
  timestamp_field?: string
  dispatch_ticket?: string | null
}

/**
 * Cambia el estado y sella la fecha del tramo.
 *
 * La compensación devuelve el estado Y la fecha anteriores: revertir solo el
 * estado dejaría una fecha de despacho en un pedido no despachado, que
 * corrompería el cálculo de lead times sin que nadie lo note.
 */
export const setStatusStep = createStep(
  'set-purchase-order-status',
  async (
    { order_id, status, timestamp_field, dispatch_ticket }: Input,
    { container }
  ) => {
    const service: any = container.resolve(PURCHASE_ORDER_MODULE)
    const antes = await service.retrievePurchaseOrder(order_id)

    const cambios: Record<string, unknown> = { id: order_id, status }
    if (timestamp_field) cambios[timestamp_field] = new Date()
    if (dispatch_ticket !== undefined) cambios.dispatch_ticket = dispatch_ticket

    await service.updatePurchaseOrders(cambios)

    return new StepResponse(
      { order_id, status },
      {
        order_id,
        status: antes.status,
        timestamp_field,
        previous_timestamp: timestamp_field ? antes[timestamp_field] : undefined,
        previous_ticket: antes.dispatch_ticket,
      }
    )
  },
  async (compensacion, { container }) => {
    if (!compensacion) return
    const service: any = container.resolve(PURCHASE_ORDER_MODULE)
    const cambios: Record<string, unknown> = {
      id: compensacion.order_id,
      status: compensacion.status,
      dispatch_ticket: compensacion.previous_ticket,
    }
    if (compensacion.timestamp_field) {
      cambios[compensacion.timestamp_field] = compensacion.previous_timestamp ?? null
    }
    await service.updatePurchaseOrders(cambios)
  }
)
