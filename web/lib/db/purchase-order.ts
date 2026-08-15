import { getPool } from './pool'
import {
  CAMPO_FECHA,
  motivoRechazo,
  puedeTransicionar,
  type EstadoPedido,
} from '@/lib/domain/purchase-order'

export type PedidoResumen = {
  id: number
  code: string
  status: EstadoPedido
  marca: string
  operacion: string
  currencyCode: string
  items: number
  paresPedidos: number
  paresConfirmados: number | null
  costoUsdCents: number
  placedAt: string | null
  dispatchedAt: string | null
  dispatchTicket: string | null
}

/** Bandeja de pedidos a la marca, del más reciente al más viejo. */
export async function listarPedidos(operacion: string): Promise<PedidoResumen[]> {
  const pool = getPool()
  const { rows } = await pool.query(
    `
    select
      po.id, po.code, po.status, po.currency_code,
      b.code as marca, o.code as operacion,
      po.placed_at, po.dispatched_at, po.dispatch_ticket,
      count(distinct poi.id)::int                          as items,
      coalesce(sum(pos.quantity_requested), 0)::int        as pares_pedidos,
      -- NULL global si NINGUNA talla se ha revisado: es distinto de cero, que
      -- significaría "revisado y no hay nada". Esa diferencia sustenta el reclamo.
      case when count(pos.quantity_confirmed) = 0 then null
           else coalesce(sum(pos.quantity_confirmed), 0)::int end as pares_confirmados,
      coalesce(sum(pos.quantity_requested * coalesce(poi.unit_cost_cents, 0)), 0)::bigint as costo_usd_cents
    from ops.purchase_order po
    join ops.brand b     on b.id = po.brand_id
    join ops.operation o on o.id = po.operation_id
    left join ops.purchase_order_item poi on poi.order_id = po.id
    left join ops.purchase_order_size pos on pos.item_id = poi.id
    where o.code = $1
    group by po.id, b.code, o.code
    order by po.created_at desc
    `,
    [operacion]
  )

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    marca: r.marca,
    operacion: r.operacion,
    currencyCode: r.currency_code,
    items: r.items,
    paresPedidos: r.pares_pedidos,
    paresConfirmados: r.pares_confirmados,
    costoUsdCents: Number(r.costo_usd_cents),
    placedAt: r.placed_at,
    dispatchedAt: r.dispatched_at,
    dispatchTicket: r.dispatch_ticket,
  }))
}

export type ResultadoTransicion = { ok: true; code: string; detalle: string } | { ok: false; error: string }

/**
 * Cambia el estado de un pedido, en una sola transacción.
 *
 * En la versión Medusa esto eran tres workflows con `validateTransitionStep`,
 * `setStatusStep` y `createTransitStockStep`, cada uno con su compensación
 * manual. Aquí la atomicidad la da Postgres.
 *
 * La validación se hace con `select … for update` sobre la fila del pedido:
 * sin eso, dos usuarios podrían aprobar y despachar a la vez, leyendo ambos el
 * mismo estado previo.
 */
export async function cambiarEstadoPedido(
  orderId: number,
  a: EstadoPedido,
  opciones: { dispatchTicket?: string; etaDays?: number } = {}
): Promise<ResultadoTransicion> {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows: poRows } = await client.query(
      `select po.id, po.code, po.status, o.id as operation_id
         from ops.purchase_order po
         join ops.operation o on o.id = po.operation_id
        where po.id = $1
        for update of po`,
      [orderId]
    )
    const pedido = poRows[0]
    if (!pedido) {
      await client.query('rollback')
      return { ok: false, error: `El pedido ${orderId} no existe.` }
    }

    const desde = pedido.status as EstadoPedido
    if (!puedeTransicionar(desde, a)) {
      await client.query('rollback')
      return { ok: false, error: motivoRechazo(pedido.code, desde, a) }
    }

    // --- Sellar estado y fecha del tramo -----------------------------------
    const campoFecha = CAMPO_FECHA[a]
    await client.query(
      `update ops.purchase_order
          set status = $2
              ${campoFecha ? `, ${campoFecha} = now()` : ''}
              ${a === 'DISPATCHED' ? ', dispatch_ticket = $3' : ''}
        where id = $1`,
      a === 'DISPATCHED'
        ? [orderId, a, opciones.dispatchTicket ?? null]
        : [orderId, a]
    )

    let detalle = ''

    /**
     * Al revisar cantidades, la marca confirma lo pedido.
     *
     * Alcance de esta entrega: confirma TODO lo solicitado. Editar talla a
     * talla (el caso real de faltante parcial) es el siguiente incremento —
     * el modelo ya lo soporta, `quantity_confirmed` es por talla.
     */
    if (a === 'QTY_CHECKED') {
      const { rowCount } = await client.query(
        `update ops.purchase_order_size pos
            set quantity_confirmed = pos.quantity_requested
           from ops.purchase_order_item poi
          where poi.id = pos.item_id
            and poi.order_id = $1
            and pos.quantity_confirmed is null`,
        [orderId]
      )
      detalle = `${rowCount} talla(s) confirmadas por la marca.`
    }

    /**
     * El despacho convierte el pedido en existencias EN TRÁNSITO.
     *
     * Usa `quantity_confirmed`, no `quantity_requested`: lo que viaja es lo
     * que la marca confirmó. Confundirlos infla el tránsito con unidades que
     * nunca se despacharon.
     *
     * Simplificación real al salir de Medusa: la versión anterior además
     * proyectaba a `inventory_level.incoming_quantity` sólo para que el admin
     * de Medusa mostrara lo que venía en camino — una segunda escritura que
     * podía divergir. Aquí `bi.v_posicion` lee el tránsito directamente de
     * `supply_availability`, así que esa proyección desapareció.
     */
    if (a === 'DISPATCHED') {
      const etaDays = opciones.etaDays ?? 30
      const { rowCount } = await client.query(
        `insert into ops.supply_availability (variant_id, operation_id, source, kind, eta_days, quantity)
         select pos.variant_id, $2, $3, 'IN_TRANSIT', $4, pos.quantity_confirmed
           from ops.purchase_order_size pos
           join ops.purchase_order_item poi on poi.id = pos.item_id
          where poi.order_id = $1
            and coalesce(pos.quantity_confirmed, 0) > 0`,
        [orderId, pedido.operation_id, `Pedido ${pedido.code}`, etaDays]
      )
      detalle = `${rowCount} talla(s) puestas en tránsito, ETA ${etaDays} días.`
    }

    await client.query('commit')
    return { ok: true, code: pedido.code, detalle }
  } catch (e) {
    await client.query('rollback')
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo cambiar el estado' }
  } finally {
    client.release()
  }
}
