import { getPool } from './pool'
import { liberarReservas } from './reservas'
import { puedeDespachar, type EstadoDespacho, type EstadoVenta } from '@/lib/domain/ventas'

// --- Catálogo vendible -------------------------------------------------------

export type TallaVendible = {
  variantId: number
  sku: string
  sizeLabel: string
  sizeValue: number | null
  disponible: number
  precioCents: number
}

export type MaterialVendible = {
  material: string
  descripcion: string
  modelo: string
  color: string
  genero: string
  foto: string | null
  tallas: TallaVendible[]
}

/**
 * Lo que se puede vender HOY: existencias propias menos lo ya reservado.
 *
 * Deliberadamente NO incluye tránsito ni disponibilidad en la marca. Esas
 * unidades no se pueden comprometer — es exactamente el error que la
 * separación de las tres naturalezas existe para impedir (CLAUDE.md §6).
 */
export async function obtenerCatalogoVendible(
  operacion: string,
  q?: string
): Promise<MaterialVendible[]> {
  const pool = getPool()
  const { rows } = await pool.query(
    `
    select
      p.material,
      max(p.modelo || ' · ' || p.color)  as descripcion,
      max(p.modelo)                      as modelo,
      max(p.color)                       as color,
      max(p.genero)                      as genero,
      max(p.thumbnail_url)               as foto,
      jsonb_agg(
        jsonb_build_object(
          'variantId',   v.id,
          'sku',         v.sku,
          'sizeLabel',   v.size_label,
          'sizeValue',   v.size_value,
          'disponible',  s.qty - s.reserved,
          -- El precio de venta en COP todavía no existe como dato (el costeo
          -- de importación está en hold), así que se captura a mano en la
          -- cotización. Ver los pendientes de CLAUDE.md §10.
          'precioCents', 0
        )
        order by v.size_value nulls last, v.size_label
      ) as tallas
    from ops.stock s
    join ops.variant v   on v.id = s.variant_id
    join ops.product p   on p.id = v.product_id
    join ops.warehouse w on w.id = s.warehouse_id
    join ops.operation o on o.id = w.operation_id
    where o.code = $1
      and s.qty - s.reserved > 0
      and ($2::text is null
           or p.modelo ilike '%' || $2 || '%'
           or p.color  ilike '%' || $2 || '%'
           or p.material ilike '%' || $2 || '%')
    group by p.material
    order by max(p.modelo), max(p.color)
    `,
    [operacion, q ?? null]
  )

  return rows.map((r) => ({
    material: r.material,
    descripcion: r.descripcion,
    modelo: r.modelo,
    color: r.color,
    genero: r.genero,
    foto: r.foto,
    tallas: r.tallas,
  }))
}

// --- Bandeja y detalle -------------------------------------------------------

export type VentaResumen = {
  id: number
  code: string
  cliente: string
  status: EstadoVenta
  etapa: string
  unidades: number
  reservadas: number
  despachadas: number
  valorCents: number
  diasSinAvanzar: number
}

export async function listarVentas(operacion: string): Promise<VentaResumen[]> {
  const pool = getPool()
  const { rows } = await pool.query(
    `select e.order_id, e.code, e.cliente, so.status, e.etapa,
            e.unidades, e.reservadas, e.despachadas, e.valor_cents, e.dias_sin_avanzar
       from bi.v_embudo e
       join ops.sales_order so on so.id = e.order_id
      where e.operacion = $1
      order by e.dias_sin_avanzar desc, e.etapa_orden`,
    [operacion]
  )
  return rows.map((r) => ({
    id: r.order_id,
    code: r.code,
    cliente: r.cliente,
    status: r.status,
    etapa: r.etapa,
    unidades: Number(r.unidades),
    reservadas: Number(r.reservadas),
    despachadas: Number(r.despachadas),
    valorCents: Number(r.valor_cents),
    diasSinAvanzar: r.dias_sin_avanzar ?? 0,
  }))
}

export type LineaVenta = {
  id: number
  sku: string
  descripcion: string
  sizeLabel: string
  cantidad: number
  reservada: number
  despachada: number
  precioCents: number
}

export type DespachoResumen = {
  id: number
  code: string
  status: EstadoDespacho
  tracking: string | null
  unidades: number
}

export type VentaDetalle = {
  id: number
  code: string
  cliente: string
  status: EstadoVenta
  etapa: string
  currencyCode: string
  bodega: string
  lineas: LineaVenta[]
  despachos: DespachoResumen[]
}

export async function obtenerVenta(orderId: number): Promise<VentaDetalle | null> {
  const pool = getPool()

  const { rows: cab } = await pool.query(
    `select so.id, so.code, so.status, so.currency_code, c.name as cliente,
            w.name as bodega, e.etapa
       from ops.sales_order so
       join ops.customer c  on c.id = so.customer_id
       join ops.warehouse w on w.id = so.warehouse_id
       left join bi.v_embudo e on e.order_id = so.id
      where so.id = $1`,
    [orderId]
  )
  if (!cab[0]) return null

  const { rows: lineas } = await pool.query(
    `select l.id, v.sku, v.size_label, l.quantity, l.unit_price_cents,
            p.modelo || ' · ' || p.color as descripcion,
            coalesce(r.reservada, 0) as reservada,
            coalesce(d.despachada, 0) as despachada
       from ops.sales_order_line l
       join ops.variant v on v.id = l.variant_id
       join ops.product p on p.id = v.product_id
       left join (
          select order_line_id, sum(quantity) as reservada
            from ops.reservation where status = 'ACTIVA' group by order_line_id
       ) r on r.order_line_id = l.id
       left join (
          select sl.order_line_id, sum(sl.quantity) as despachada
            from ops.shipment_line sl
            join ops.shipment s on s.id = sl.shipment_id
           where s.status in ('DESPACHADO','ENTREGADO')
           group by sl.order_line_id
       ) d on d.order_line_id = l.id
      where l.order_id = $1
      order by p.modelo, p.color, v.size_value nulls last`,
    [orderId]
  )

  const { rows: despachos } = await pool.query(
    `select s.id, s.code, s.status, s.tracking,
            coalesce(sum(sl.quantity), 0)::int as unidades
       from ops.shipment s
       left join ops.shipment_line sl on sl.shipment_id = s.id
      where s.order_id = $1
      group by s.id
      order by s.created_at`,
    [orderId]
  )

  return {
    id: cab[0].id,
    code: cab[0].code,
    cliente: cab[0].cliente,
    status: cab[0].status,
    etapa: cab[0].etapa ?? 'PEDIDO',
    currencyCode: cab[0].currency_code,
    bodega: cab[0].bodega,
    lineas: lineas.map((l) => ({
      id: l.id,
      sku: l.sku,
      descripcion: l.descripcion,
      sizeLabel: l.size_label,
      cantidad: l.quantity,
      reservada: Number(l.reservada),
      despachada: Number(l.despachada),
      precioCents: Number(l.unit_price_cents),
    })),
    despachos: despachos.map((d) => ({
      id: d.id,
      code: d.code,
      status: d.status,
      tracking: d.tracking,
      unidades: d.unidades,
    })),
  }
}

// --- Crear cotización --------------------------------------------------------

export type NuevaVenta = {
  operacion: string
  customerId: number
  lineas: { variantId: number; cantidad: number; precioCents: number }[]
  notes?: string
}

export async function crearCotizacion(
  datos: NuevaVenta
): Promise<{ ok: true; id: number; code: string } | { ok: false; error: string }> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const { rows: op } = await client.query('select id from ops.operation where code = $1', [datos.operacion])
    if (!op[0]) throw new Error(`Operación desconocida: ${datos.operacion}`)
    const operationId = op[0].id

    // Una sola bodega hoy. Cuando haya varias, la elige el vendedor: la
    // reserva es POR BODEGA y reservar "en abstracto" no se puede alistar.
    const { rows: wh } = await client.query(
      'select id from ops.warehouse where operation_id = $1 and is_active order by id limit 1',
      [operationId]
    )
    if (!wh[0]) throw new Error('No hay bodega activa en esta operación.')

    const { rows: previos } = await client.query(
      'select count(*)::int as n from ops.sales_order where operation_id = $1',
      [operationId]
    )
    const code = `SO-${datos.operacion}-${String(previos[0].n + 1).padStart(4, '0')}`

    const { rows: so } = await client.query(
      `insert into ops.sales_order (code, operation_id, customer_id, warehouse_id, status, currency_code, notes, quoted_at)
       values ($1,$2,$3,$4,'COTIZACION',$5,$6,now()) returning id`,
      [code, operationId, datos.customerId, wh[0].id, 'cop', datos.notes ?? null]
    )
    const orderId = so[0].id

    for (const l of datos.lineas) {
      if (l.cantidad <= 0) continue
      await client.query(
        `insert into ops.sales_order_line (order_id, variant_id, quantity, unit_price_cents)
         values ($1,$2,$3,$4)`,
        [orderId, l.variantId, l.cantidad, l.precioCents]
      )
    }

    await client.query('commit')
    return { ok: true, id: orderId, code }
  } catch (e) {
    await client.query('rollback')
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo crear la cotización' }
  } finally {
    client.release()
  }
}

// --- Transiciones del pedido -------------------------------------------------

export type Resultado = { ok: true; detalle: string } | { ok: false; error: string }

export async function confirmarVenta(orderId: number): Promise<Resultado> {
  const pool = getPool()
  const { rowCount } = await pool.query(
    `update ops.sales_order set status='CONFIRMADO', confirmed_at=now()
      where id=$1 and status='COTIZACION'`,
    [orderId]
  )
  return rowCount === 1
    ? { ok: true, detalle: 'Cotización confirmada como pedido en firme.' }
    : { ok: false, error: 'Sólo una cotización se puede confirmar.' }
}

/**
 * Cancelar un pedido libera lo reservado.
 *
 * Si no se liberase, `stock.reserved` quedaría alto para siempre y el
 * disponible se encogería en silencio — el modo de falla exacto contra el que
 * existe `bi.v_reserva_cuadre` (CLAUDE.md §5).
 */
export async function cancelarVenta(orderId: number): Promise<Resultado> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const { rows } = await client.query(
      'select status from ops.sales_order where id=$1 for update',
      [orderId]
    )
    if (!rows[0]) throw new Error('El pedido no existe.')
    if (rows[0].status === 'CANCELADO') throw new Error('El pedido ya está cancelado.')

    const { rows: desp } = await client.query(
      `select count(*)::int as n from ops.shipment
        where order_id=$1 and status in ('DESPACHADO','ENTREGADO')`,
      [orderId]
    )
    if (desp[0].n > 0) {
      throw new Error('No se puede cancelar: ya hay mercancía despachada. Usa una devolución.')
    }

    const liberados = await liberarReservas(client, orderId)
    await client.query(
      "update ops.sales_order set status='CANCELADO', cancelled_at=now() where id=$1",
      [orderId]
    )

    await client.query('commit')
    return { ok: true, detalle: `Pedido cancelado. ${liberados} par(es) liberados.` }
  } catch (e) {
    await client.query('rollback')
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo cancelar' }
  } finally {
    client.release()
  }
}

/** Crea un despacho con lo reservado y aún no despachado. */
export async function crearDespacho(orderId: number): Promise<Resultado> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const { rows: so } = await client.query(
      'select code, status, warehouse_id, operation_id from ops.sales_order where id=$1 for update',
      [orderId]
    )
    if (!so[0]) throw new Error('El pedido no existe.')
    if (so[0].status !== 'CONFIRMADO') throw new Error('Sólo un pedido confirmado se puede alistar.')

    const { rows: pendientes } = await client.query(
      `select l.id as order_line_id, l.variant_id,
              coalesce(r.reservada,0) - coalesce(d.despachada,0) as por_despachar
         from ops.sales_order_line l
         left join (select order_line_id, sum(quantity) as reservada from ops.reservation
                     where status='ACTIVA' group by order_line_id) r on r.order_line_id = l.id
         left join (select sl.order_line_id, sum(sl.quantity) as despachada
                      from ops.shipment_line sl join ops.shipment s on s.id=sl.shipment_id
                     where s.status <> 'CANCELADO' group by sl.order_line_id) d on d.order_line_id = l.id
        where l.order_id = $1`,
      [orderId]
    )
    const conSaldo = pendientes.filter((p) => Number(p.por_despachar) > 0)
    if (conSaldo.length === 0) {
      throw new Error('No hay nada reservado pendiente de despachar. Reserva primero.')
    }

    const { rows: previos } = await client.query('select count(*)::int as n from ops.shipment')
    const code = `SH-CO-${String(previos[0].n + 1).padStart(4, '0')}`

    const { rows: sh } = await client.query(
      `insert into ops.shipment (code, order_id, warehouse_id, status)
       values ($1,$2,$3,'ALISTANDO') returning id`,
      [code, orderId, so[0].warehouse_id]
    )

    for (const p of conSaldo) {
      await client.query(
        `insert into ops.shipment_line (shipment_id, order_line_id, variant_id, quantity)
         values ($1,$2,$3,$4)`,
        [sh[0].id, p.order_line_id, p.variant_id, Number(p.por_despachar)]
      )
    }

    await client.query('commit')
    return { ok: true, detalle: `Despacho ${code} creado con ${conSaldo.length} línea(s).` }
  } catch (e) {
    await client.query('rollback')
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo crear el despacho' }
  } finally {
    client.release()
  }
}

/**
 * Mueve un despacho de estado.
 *
 * El paso a DESPACHADO es el único que toca el inventario, y hace TRES cosas en
 * la misma transacción o ninguna:
 *   1. baja `stock.qty`     — la mercancía salió físicamente
 *   2. baja `stock.reserved`— deja de estar comprometida, ya se entregó
 *   3. escribe `stock_move` — el kardex, para poder responder después "¿por qué
 *      esta talla tiene 3 y no 5?" (CLAUDE.md §5: toda mutación de stock
 *      escribe en el kardex, sin excepciones)
 *
 * Las reservas pasan a CONSUMIDA, no a LIBERADA: no se soltaron, se
 * convirtieron en salida. Confundirlas rompería el cuadre.
 */
export async function moverDespacho(shipmentId: number, a: EstadoDespacho): Promise<Resultado> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const { rows } = await client.query(
      'select id, code, status, order_id, warehouse_id from ops.shipment where id=$1 for update',
      [shipmentId]
    )
    if (!rows[0]) throw new Error('El despacho no existe.')
    const despacho = rows[0]
    const desde = despacho.status as EstadoDespacho

    if (!puedeDespachar(desde, a)) {
      throw new Error(`Un despacho en ${desde} no puede pasar a ${a}.`)
    }

    const campoFecha =
      a === 'EMPACADO' ? 'packed_at' : a === 'DESPACHADO' ? 'shipped_at' : a === 'ENTREGADO' ? 'delivered_at' : null

    await client.query(
      `update ops.shipment set status=$2 ${campoFecha ? `, ${campoFecha} = now()` : ''} where id=$1`,
      [shipmentId, a]
    )

    let detalle = `Despacho ${despacho.code} → ${a}.`

    if (a === 'DESPACHADO') {
      const { rows: lineas } = await client.query(
        'select order_line_id, variant_id, quantity from ops.shipment_line where shipment_id=$1',
        [shipmentId]
      )

      for (const l of lineas) {
        const { rowCount } = await client.query(
          `update ops.stock
              set qty = qty - $3, reserved = reserved - $3
            where variant_id=$1 and warehouse_id=$2 and qty >= $3 and reserved >= $3`,
          [l.variant_id, despacho.warehouse_id, l.quantity]
        )
        if (rowCount === 0) {
          throw new Error(
            `No hay saldo o reserva suficiente para despachar la variante ${l.variant_id}. ` +
              'Revisa el cuadre de reservas.'
          )
        }

        const { rows: saldo } = await client.query(
          'select qty from ops.stock where variant_id=$1 and warehouse_id=$2',
          [l.variant_id, despacho.warehouse_id]
        )

        await client.query(
          `insert into ops.stock_move
             (variant_id, warehouse_id, kind, quantity, reference_type, reference_id, balance_after, notes)
           values ($1,$2,'SALE',$3,'shipment',$4,$5,$6)`,
          [
            l.variant_id,
            despacho.warehouse_id,
            -l.quantity, // negativa: sale. El signo va en la cantidad, no en el tipo.
            despacho.code,
            saldo[0].qty,
            `Despacho ${despacho.code}`,
          ]
        )

        // La reserva se CONSUME, no se libera: se convirtió en salida.
        await client.query(
          `update ops.reservation set status='CONSUMIDA', released_at=now()
            where order_line_id=$1 and status='ACTIVA'`,
          [l.order_line_id]
        )
      }
      detalle = `Despacho ${despacho.code} salió. ${lineas.length} línea(s) descontadas del inventario con su asiento en el kardex.`
    }

    await client.query('commit')
    return { ok: true, detalle }
  } catch (e) {
    await client.query('rollback')
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo mover el despacho' }
  } finally {
    client.release()
  }
}
