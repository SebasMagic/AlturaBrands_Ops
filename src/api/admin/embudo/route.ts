import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/**
 * GET /admin/embudo
 *
 * Se sirve de bi.v_embudo, que deriva la etapa de los campos nativos de
 * Medusa. No hay estado propio que mantener: si alguien despacha desde el
 * admin sin pasar por aquí, el tablero lo refleja igual.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const [resumen, pedidos] = await Promise.all([
    knex.raw(
      `select etapa, etapa_orden, pedidos, unidades, valor,
              dias_max_sin_avanzar, atascados
       from bi.v_embudo_resumen
       order by etapa_orden`
    ),
    knex.raw(
      `select order_id, display_id, cliente, currency_code, etapa, etapa_orden,
              unidades, valor, reservas, alistadas, despachadas, entregadas,
              dias_sin_avanzar, created_at
       from bi.v_embudo
       order by etapa_orden, dias_sin_avanzar desc, display_id`
    ),
  ])

  const numerico = (r: any) => ({
    ...r,
    pedidos: r.pedidos === undefined ? undefined : Number(r.pedidos),
    unidades: Number(r.unidades ?? 0),
    valor: Number(r.valor ?? 0),
    reservas: r.reservas === undefined ? undefined : Number(r.reservas),
    alistadas: r.alistadas === undefined ? undefined : Number(r.alistadas),
    despachadas: r.despachadas === undefined ? undefined : Number(r.despachadas),
    entregadas: r.entregadas === undefined ? undefined : Number(r.entregadas),
  })

  res.json({
    resumen: (resumen.rows ?? []).map(numerico),
    pedidos: (pedidos.rows ?? []).map(numerico),
  })
}
