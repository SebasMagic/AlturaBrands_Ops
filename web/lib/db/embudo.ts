import { getPool } from './pool'

export type Etapa =
  | 'COTIZACION'
  | 'PEDIDO'
  | 'RESERVADO'
  | 'EMPACADO'
  | 'DESPACHO PARCIAL'
  | 'DESPACHADO'
  | 'ENTREGADO'
  | 'CANCELADO'

export type FilaEmbudo = {
  orderId: number
  code: string
  cliente: string
  etapa: Etapa
  etapaOrden: number
  unidades: number
  valorCents: number
  reservadas: number
  alistadas: number
  despachadas: number
  entregadas: number
  diasSinAvanzar: number
}

export type ResumenEtapa = {
  etapa: Etapa
  etapaOrden: number
  pedidos: number
  unidades: number
  valorCents: number
  atascados: number
  diasMaxSinAvanzar: number
}

/** El tablero: una fila por etapa. */
export async function obtenerResumenEmbudo(operacion: string): Promise<ResumenEtapa[]> {
  const pool = getPool()
  const { rows } = await pool.query(
    `select etapa, etapa_orden, pedidos, unidades, valor_cents, atascados, dias_max_sin_avanzar
       from bi.v_embudo_resumen where operacion = $1 order by etapa_orden`,
    [operacion]
  )
  return rows.map((r) => ({
    etapa: r.etapa,
    etapaOrden: r.etapa_orden,
    pedidos: Number(r.pedidos),
    unidades: Number(r.unidades),
    valorCents: Number(r.valor_cents),
    atascados: Number(r.atascados),
    diasMaxSinAvanzar: Number(r.dias_max_sin_avanzar ?? 0),
  }))
}

/** El detalle: un pedido por fila, el más atascado primero. */
export async function obtenerDetalleEmbudo(operacion: string): Promise<FilaEmbudo[]> {
  const pool = getPool()
  const { rows } = await pool.query(
    `select order_id, code, cliente, etapa, etapa_orden, unidades, valor_cents,
            reservadas, alistadas, despachadas, entregadas, dias_sin_avanzar
       from bi.v_embudo
      where operacion = $1
      -- Lo atascado primero: es la pantalla de destrabar, no de contemplar.
      order by dias_sin_avanzar desc, etapa_orden`,
    [operacion]
  )
  return rows.map((r) => ({
    orderId: r.order_id,
    code: r.code,
    cliente: r.cliente,
    etapa: r.etapa,
    etapaOrden: r.etapa_orden,
    unidades: Number(r.unidades),
    valorCents: Number(r.valor_cents),
    reservadas: Number(r.reservadas),
    alistadas: Number(r.alistadas),
    despachadas: Number(r.despachadas),
    entregadas: Number(r.entregadas),
    diasSinAvanzar: r.dias_sin_avanzar ?? 0,
  }))
}

export type DescuadreReserva = {
  sku: string
  bodega: string
  fisico: number
  reservadoEnStock: number
  reservadoEnReservas: number
}

/**
 * Descuadres entre `stock.reserved` y las reservas activas.
 *
 * En condiciones normales devuelve vacío. Cualquier fila aquí es un bug: hay
 * un camino que movió el contador sin registrar la reserva, o al revés
 * (CLAUDE.md §5).
 */
export async function obtenerDescuadresReserva(): Promise<DescuadreReserva[]> {
  const pool = getPool()
  const { rows } = await pool.query(
    `select sku, bodega, fisico, reservado_en_stock, reservado_en_reservas
       from bi.v_reserva_cuadre where not cuadra order by sku`
  )
  return rows.map((r) => ({
    sku: r.sku,
    bodega: r.bodega,
    fisico: r.fisico,
    reservadoEnStock: r.reservado_en_stock,
    reservadoEnReservas: Number(r.reservado_en_reservas),
  }))
}
