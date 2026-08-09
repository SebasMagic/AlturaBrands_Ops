import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk'

import { createTransitStockStep } from './steps/create-transit-stock'
import { setStatusStep } from './steps/set-status'
import { validateTransitionStep } from './steps/validate-transition'

/**
 * Transiciones del pedido a marca. Toda operación que toque más de un módulo
 * es un workflow, y cada step lleva su compensación (CLAUDE.md §4.3).
 */

// --- Montado -> Cantidad Check/Ajustado -------------------------------------
export const checkQuantitiesWorkflow = createWorkflow(
  'purchase-order-check-quantities',
  (input: { order_id: string }) => {
    validateTransitionStep({ order_id: input.order_id, to: 'QTY_CHECKED' })
    const res = setStatusStep({
      order_id: input.order_id,
      status: 'QTY_CHECKED',
      timestamp_field: 'qty_checked_at',
    })
    return new WorkflowResponse(res)
  }
)

// --- Cantidad Check -> Aprobación Cliente -----------------------------------
export const approvePurchaseOrderWorkflow = createWorkflow(
  'purchase-order-approve',
  (input: { order_id: string }) => {
    validateTransitionStep({ order_id: input.order_id, to: 'CLIENT_APPROVED' })
    const res = setStatusStep({
      order_id: input.order_id,
      status: 'CLIENT_APPROVED',
      timestamp_field: 'approved_at',
    })
    return new WorkflowResponse(res)
  }
)

/**
 * Aprobación Cliente -> Despachado.
 *
 * Es la única transición con efectos fuera del pedido: crea las existencias en
 * tránsito. Si la creación falla a medias, la compensación revierte también el
 * estado, de modo que no queda un pedido marcado como despachado sin su
 * mercancía en camino.
 */
export const dispatchPurchaseOrderWorkflow = createWorkflow(
  'purchase-order-dispatch',
  (input: { order_id: string; dispatch_ticket: string; eta_days: number }) => {
    validateTransitionStep({ order_id: input.order_id, to: 'DISPATCHED' })

    setStatusStep({
      order_id: input.order_id,
      status: 'DISPATCHED',
      timestamp_field: 'dispatched_at',
      dispatch_ticket: input.dispatch_ticket,
    })

    const stock = createTransitStockStep({
      order_id: input.order_id,
      eta_days: input.eta_days,
    })

    return new WorkflowResponse(stock)
  }
)
