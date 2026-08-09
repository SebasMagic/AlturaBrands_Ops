import { MedusaError } from '@medusajs/framework/utils'
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'

import { PURCHASE_ORDER_MODULE } from '../../../modules/purchase-order'

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'QTY_CHECKED'
  | 'CLIENT_APPROVED'
  | 'DISPATCHED'
  | 'CANCELLED'

/**
 * Transiciones permitidas. Un pedido no puede saltar de Montado a Despachado
 * sin que la marca haya confirmado cantidades: eso metería en tránsito
 * unidades que nadie verificó que existan.
 */
const TRANSICIONES: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ['QTY_CHECKED', 'CANCELLED'],
  QTY_CHECKED: ['CLIENT_APPROVED', 'DRAFT', 'CANCELLED'],
  CLIENT_APPROVED: ['DISPATCHED', 'QTY_CHECKED', 'CANCELLED'],
  DISPATCHED: [],
  CANCELLED: [],
}

type Input = { order_id: string; to: PurchaseOrderStatus }

export const validateTransitionStep = createStep(
  'validate-purchase-order-transition',
  async ({ order_id, to }: Input, { container }) => {
    const service: any = container.resolve(PURCHASE_ORDER_MODULE)
    const order = await service.retrievePurchaseOrder(order_id)

    const desde = order.status as PurchaseOrderStatus
    const permitidas = TRANSICIONES[desde] ?? []

    if (!permitidas.includes(to)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `El pedido ${order.code} está en ${desde} y no puede pasar a ${to}. ` +
          `Transiciones válidas desde ${desde}: ${permitidas.join(', ') || 'ninguna'}.`
      )
    }

    // No modifica nada: no necesita compensación.
    return new StepResponse({ order, from: desde })
  }
)
