import { getPool } from './pool'
import { liberarReservas } from './reservas'
import type { EtapaComercial, Oportunidad } from '@/lib/domain/comercial'

/** Oportunidades del embudo comercial: todas las ventas, en cualquier etapa. */
export async function listarOportunidades(operacion: string): Promise<Oportunidad[]> {
  const pool = getPool()
  const { rows } = await pool.query(
    `
    select
      so.id, so.code, so.status, so.etapa_comercial, so.orden_tablero,
      c.name as cliente,
      coalesce(sum(l.quantity), 0)::int                      as unidades,
      coalesce(sum(l.quantity * l.unit_price_cents), 0)::bigint as valor_cents,
      -- Días desde el último movimiento real del documento. Lo que delata una
      -- oportunidad estancada no es cuándo nació sino cuánto lleva quieta.
      extract(day from now() - coalesce(so.confirmed_at, so.quoted_at, so.created_at))::int
                                                             as dias_sin_avanzar
    from ops.sales_order so
    join ops.customer  c on c.id = so.customer_id
    join ops.operation o on o.id = so.operation_id
    left join ops.sales_order_line l on l.order_id = so.id
    where o.code = $1
    group by so.id, c.name
    order by so.orden_tablero, so.id
    `,
    [operacion]
  )

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    cliente: r.cliente,
    etapa: r.etapa_comercial,
    status: r.status,
    unidades: r.unidades,
    valorCents: Number(r.valor_cents),
    diasSinAvanzar: r.dias_sin_avanzar ?? 0,
    ordenTablero: r.orden_tablero,
  }))
}

export type ResultadoMover = { ok: true; detalle: string } | { ok: false; error: string }

/**
 * Mueve una oportunidad de etapa, y con ella el documento de venta.
 *
 * La etapa comercial y el estado del pedido se mantienen coherentes en la
 * misma transacción, porque son dos caras de lo mismo:
 *
 *   → GANADO   el pedido pasa a firme (CONFIRMADO). A partir de ahí puede
 *              reservar inventario y aparece en Operaciones.
 *   → PERDIDO  se cancela y se LIBERA lo reservado. Si no se liberase,
 *              `stock.reserved` quedaría alto para siempre y el disponible se
 *              encogería en silencio (CLAUDE.md §5).
 *   → resto    vuelve a ser cotización; también libera, porque una propuesta
 *              no debe retener stock que otro cliente podría llevarse.
 *
 * Se rechaza mover algo que ya tiene mercancía despachada: eso ya salió por la
 * puerta y no se deshace arrastrando una tarjeta.
 */
export async function moverOportunidad(
  orderId: number,
  aEtapa: EtapaComercial,
  nuevoOrden: number
): Promise<ResultadoMover> {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows } = await client.query(
      'select code, status, etapa_comercial from ops.sales_order where id = $1 for update',
      [orderId]
    )
    const venta = rows[0]
    if (!venta) throw new Error('La oportunidad no existe.')

    const { rows: desp } = await client.query(
      `select count(*)::int as n from ops.shipment
        where order_id = $1 and status in ('DESPACHADO','ENTREGADO')`,
      [orderId]
    )
    if (desp[0].n > 0 && aEtapa !== 'GANADO') {
      throw new Error(
        `${venta.code} ya tiene mercancía despachada. Sacarlo de Ganado no la devuelve: ` +
          'eso se corrige con una devolución.'
      )
    }

    let detalle = `${venta.code} → ${aEtapa}.`

    if (aEtapa === 'GANADO') {
      if (venta.status === 'COTIZACION') {
        await client.query(
          "update ops.sales_order set status='CONFIRMADO', confirmed_at=now() where id=$1",
          [orderId]
        )
        detalle = `${venta.code} ganado: el pedido pasó a firme y ya puede reservar.`
      }
    } else if (aEtapa === 'PERDIDO') {
      const liberados = await liberarReservas(client, orderId)
      await client.query(
        "update ops.sales_order set status='CANCELADO', cancelled_at=now() where id=$1",
        [orderId]
      )
      detalle = `${venta.code} marcado como perdido.${liberados > 0 ? ` Se liberaron ${liberados} par(es).` : ''}`
    } else if (venta.status !== 'COTIZACION') {
      const liberados = await liberarReservas(client, orderId)
      await client.query(
        "update ops.sales_order set status='COTIZACION', confirmed_at=null, cancelled_at=null where id=$1",
        [orderId]
      )
      detalle = `${venta.code} vuelve a cotización.${liberados > 0 ? ` Se liberaron ${liberados} par(es).` : ''}`
    }

    await client.query(
      'update ops.sales_order set etapa_comercial=$2, orden_tablero=$3 where id=$1',
      [orderId, aEtapa, nuevoOrden]
    )

    await client.query('commit')
    return { ok: true, detalle }
  } catch (e) {
    await client.query('rollback')
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo mover' }
  } finally {
    client.release()
  }
}
