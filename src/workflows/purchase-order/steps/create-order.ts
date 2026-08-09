import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'

import { PURCHASE_ORDER_MODULE } from '../../../modules/purchase-order'

export type ItemInput = {
  material_code: string
  description: string
  size_curve_code: string | null
  packs: number
  is_adjusted: boolean
  adjustment_note: string | null
  unit_cost_cents: number | null
  sizes: {
    sku: string
    size_label: string
    size_value: number
    quantity_requested: number
  }[]
}

export type CreateOrderInput = {
  operation_code: string
  brand_code: string
  currency_code: string
  notes?: string | null
  items: ItemInput[]
}

/**
 * Crea el pedido completo: cabecera, ítems y detalle por talla.
 *
 * Va en un solo step a propósito. Dividirlo en tres dejaría la puerta abierta
 * a un pedido con cabecera y sin líneas si el segundo falla, y un pedido vacío
 * es peor que ninguno: parece válido en los listados.
 */
export const createOrderStep = createStep(
  'create-purchase-order',
  async (input: CreateOrderInput, { container }) => {
    const service: any = container.resolve(PURCHASE_ORDER_MODULE)

    const previos = await service.listPurchaseOrders(
      { operation_code: input.operation_code, brand_code: input.brand_code },
      { select: ['id'] }
    )
    const code = `PO-${input.operation_code}-${input.brand_code}-${String(
      previos.length + 1
    ).padStart(4, '0')}`

    const order = await service.createPurchaseOrders({
      code,
      operation_code: input.operation_code,
      brand_code: input.brand_code,
      currency_code: input.currency_code,
      status: 'DRAFT',
      placed_at: new Date(),
      notes: input.notes ?? null,
    })

    const itemIds: string[] = []
    const sizeIds: string[] = []

    for (const it of input.items) {
      const item = await service.createPurchaseOrderItems({
        material_code: it.material_code,
        description: it.description,
        size_curve_code: it.size_curve_code,
        packs: it.packs,
        is_adjusted: it.is_adjusted,
        adjustment_note: it.adjustment_note,
        unit_cost_cents: it.unit_cost_cents,
        order_id: order.id,
      })
      itemIds.push(item.id)

      const sizes = await service.createPurchaseOrderSizes(
        it.sizes.map((s) => ({ ...s, item_id: item.id }))
      )
      sizeIds.push(...sizes.map((s: any) => s.id))
    }

    const pares = input.items.reduce(
      (a, i) => a + i.sizes.reduce((b, s) => b + s.quantity_requested, 0),
      0
    )

    return new StepResponse(
      { id: order.id, code, items: itemIds.length, pares },
      { order_id: order.id, itemIds, sizeIds }
    )
  },
  async (compensacion, { container }) => {
    if (!compensacion) return
    const service: any = container.resolve(PURCHASE_ORDER_MODULE)
    // De la hoja hacia la raíz: borrar la cabecera con hijos vivos deja
    // referencias colgando.
    if (compensacion.sizeIds?.length) {
      await service.deletePurchaseOrderSizes(compensacion.sizeIds)
    }
    if (compensacion.itemIds?.length) {
      await service.deletePurchaseOrderItems(compensacion.itemIds)
    }
    await service.deletePurchaseOrders([compensacion.order_id])
  }
)
