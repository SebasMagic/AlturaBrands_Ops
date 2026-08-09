import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'

import { PURCHASE_ORDER_MODULE } from '../../../modules/purchase-order'
import { createPurchaseOrderWorkflow } from '../../../workflows/purchase-order'
import type { CreateOrderInput } from '../../../workflows/purchase-order/steps/create-order'

/** GET /admin/pedidos — listado para la bandeja. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: any = req.scope.resolve(PURCHASE_ORDER_MODULE)
  const { operacion, estado } = req.query as Record<string, string | undefined>

  const filtros: Record<string, unknown> = {}
  if (operacion) filtros.operation_code = operacion
  if (estado) filtros.status = estado

  const pedidos = await service.listPurchaseOrders(filtros, {
    order: { created_at: 'DESC' },
  })
  res.json({ pedidos, count: pedidos.length })
}

/**
 * POST /admin/pedidos — crea un pedido desde la grilla.
 *
 * La ruta solo valida la forma y orquesta el workflow: la lógica de negocio
 * vive allí, con su compensación (CLAUDE.md §6).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as CreateOrderInput

  if (!body?.operation_code || !body?.brand_code) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'Faltan operation_code y brand_code.'
    )
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'El pedido no tiene líneas.'
    )
  }

  const sinTallas = body.items.filter((i) => !i.sizes?.length)
  if (sinTallas.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Hay ${sinTallas.length} línea(s) sin cantidades: ` +
        sinTallas.map((i) => i.material_code).join(', ')
    )
  }

  const { result } = await createPurchaseOrderWorkflow(req.scope).run({
    input: {
      operation_code: body.operation_code,
      brand_code: body.brand_code,
      currency_code: body.currency_code ?? 'usd',
      notes: body.notes ?? 'Creado desde la grilla del admin',
      items: body.items,
    },
  })

  res.status(201).json(result)
}
