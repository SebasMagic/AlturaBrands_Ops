import { createStep, createWorkflow, StepResponse, WorkflowResponse } from '@medusajs/framework/workflows-sdk'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

import { GOODS_RECEIPT_MODULE } from '../../modules/goods-receipt'
import { applyReceiptStockStep } from './steps/apply-receipt-stock'

/** Marca la recepción como confirmada y sella la fecha. */
const markConfirmedStep = createStep(
  'mark-goods-receipt-confirmed',
  async ({ receipt_id }: { receipt_id: string }, { container }) => {
    const service: any = container.resolve(GOODS_RECEIPT_MODULE)
    const antes = await service.retrieveGoodsReceipt(receipt_id)

    await service.updateGoodsReceipts({
      id: receipt_id,
      status: 'CONFIRMED',
      confirmed_at: new Date(),
    })

    return new StepResponse({ receipt_id }, {
      receipt_id,
      status: antes.status,
      confirmed_at: antes.confirmed_at,
    })
  },
  async (compensacion, { container }) => {
    if (!compensacion) return
    const service: any = container.resolve(GOODS_RECEIPT_MODULE)
    await service.updateGoodsReceipts({
      id: compensacion.receipt_id,
      status: compensacion.status,
      confirmed_at: compensacion.confirmed_at ?? null,
    })
  }
)

/**
 * Confirma una recepción de mercancía.
 *
 * El orden importa: primero se aplica el stock, y solo si eso sale bien se
 * marca como confirmada. Al revés quedaría una recepción "confirmada" cuya
 * mercancía nunca entró — y eso es peor que un fallo, porque nadie lo nota
 * hasta que falta el inventario.
 */
export const confirmGoodsReceiptWorkflow = createWorkflow(
  'confirm-goods-receipt',
  (input: { receipt_id: string }) => {
    const resultado = applyReceiptStockStep({ receipt_id: input.receipt_id })
    markConfirmedStep({ receipt_id: input.receipt_id })
    return new WorkflowResponse(resultado)
  }
)
