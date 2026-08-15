import type { PoolClient } from 'pg'
import { getPool } from './pool'

export type ResultadoReserva =
  | { ok: true; reservados: number }
  | { ok: false; error: string; faltantes: { sku: string; pedido: number; disponible: number }[] }

/**
 * Reserva el inventario de un pedido, en una sola transacción.
 *
 * LA SENTENCIA CLAVE (CLAUDE.md §5):
 *
 *   update ops.stock set reserved = reserved + $n
 *    where variant_id = $v and warehouse_id = $w and qty - reserved >= $n
 *
 * Es UNA sola sentencia atómica, nunca leer-y-después-escribir. El error
 * clásico —dos vendedores consultan disponible, ambos ven 5, ambos comprometen
 * 4, ambos pasan— sale natural si se escribe como `select` y luego `update`.
 * Postgres serializa solo los `update` concurrentes sobre la misma fila: si
 * devuelve 0 filas, no había disponible. Sin locks explícitos.
 *
 * El CHECK `reserved <= qty` de la tabla es la red por si algún día otro camino
 * se equivoca: la base rechaza antes que dejar pasar una sobreventa.
 */
export async function reservarPedido(orderId: number): Promise<ResultadoReserva> {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows: soRows } = await client.query(
      `select id, code, status, warehouse_id from ops.sales_order where id = $1 for update`,
      [orderId]
    )
    const pedido = soRows[0]
    if (!pedido) {
      await client.query('rollback')
      return { ok: false, error: `El pedido ${orderId} no existe.`, faltantes: [] }
    }
    if (pedido.status !== 'CONFIRMADO') {
      await client.query('rollback')
      return {
        ok: false,
        // Una cotización no compromete inventario: es una propuesta, y
        // reservar contra ella bloquearía stock que nadie prometió.
        error: `${pedido.code} está en ${pedido.status}. Sólo un pedido CONFIRMADO puede reservar.`,
        faltantes: [],
      }
    }

    const { rows: lineas } = await client.query(
      `select l.id, l.variant_id, l.quantity, v.sku,
              coalesce(r.ya, 0) as ya_reservado
         from ops.sales_order_line l
         join ops.variant v on v.id = l.variant_id
         left join (
            select order_line_id, sum(quantity) as ya
              from ops.reservation where status = 'ACTIVA'
             group by order_line_id
         ) r on r.order_line_id = l.id
        where l.order_id = $1`,
      [orderId]
    )

    const faltantes: { sku: string; pedido: number; disponible: number }[] = []
    let reservados = 0

    for (const linea of lineas) {
      const pendiente = linea.quantity - Number(linea.ya_reservado)
      if (pendiente <= 0) continue

      // --- La sentencia atómica ---
      const { rowCount } = await client.query(
        `update ops.stock
            set reserved = reserved + $3
          where variant_id = $1 and warehouse_id = $2
            and qty - reserved >= $3`,
        [linea.variant_id, pedido.warehouse_id, pendiente]
      )

      if (rowCount === 0) {
        // No alcanzó. Se consulta el disponible SOLO para el mensaje de error;
        // la decisión ya la tomó el update de arriba, no esta lectura.
        const { rows: disp } = await client.query(
          `select qty - reserved as disponible from ops.stock
            where variant_id = $1 and warehouse_id = $2`,
          [linea.variant_id, pedido.warehouse_id]
        )
        faltantes.push({
          sku: linea.sku,
          pedido: pendiente,
          disponible: disp[0]?.disponible ?? 0,
        })
        continue
      }

      await client.query(
        `insert into ops.reservation (order_line_id, variant_id, warehouse_id, quantity)
         values ($1,$2,$3,$4)`,
        [linea.id, linea.variant_id, pedido.warehouse_id, pendiente]
      )
      reservados += pendiente
    }

    // Todo o nada: una reserva parcial dejaría al vendedor creyendo que tiene
    // el pedido cubierto cuando le faltan tallas.
    if (faltantes.length > 0) {
      await client.query('rollback')
      return {
        ok: false,
        error: `No hay disponible para ${faltantes.length} talla(s). No se reservó nada.`,
        faltantes,
      }
    }

    await client.query('commit')
    return { ok: true, reservados }
  } catch (e) {
    await client.query('rollback')
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'No se pudo reservar',
      faltantes: [],
    }
  } finally {
    client.release()
  }
}

/**
 * Libera las reservas activas de un pedido (cancelación).
 *
 * Baja `reserved` exactamente en lo que estaba reservado — no recalcula ni
 * resta "a ojo": ese es justo el camino por el que el contador se desincroniza.
 */
export async function liberarReservas(client: PoolClient, orderId: number): Promise<number> {
  const { rows } = await client.query(
    `select r.id, r.variant_id, r.warehouse_id, r.quantity
       from ops.reservation r
       join ops.sales_order_line l on l.id = r.order_line_id
      where l.order_id = $1 and r.status = 'ACTIVA'
      for update of r`,
    [orderId]
  )

  let liberados = 0
  for (const r of rows) {
    await client.query(
      `update ops.stock set reserved = reserved - $3
        where variant_id = $1 and warehouse_id = $2`,
      [r.variant_id, r.warehouse_id, r.quantity]
    )
    await client.query(
      `update ops.reservation set status = 'LIBERADA', released_at = now() where id = $1`,
      [r.id]
    )
    liberados += r.quantity
  }
  return liberados
}
