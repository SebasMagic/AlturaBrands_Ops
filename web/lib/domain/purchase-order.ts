export type EstadoPedido =
  | 'DRAFT'
  | 'QTY_CHECKED'
  | 'CLIENT_APPROVED'
  | 'DISPATCHED'
  | 'CANCELLED'

/**
 * Transiciones permitidas.
 *
 * Un pedido NO puede saltar de Montado a Despachado sin que la marca haya
 * confirmado cantidades: eso metería en tránsito unidades que nadie verificó
 * que existan. Es la regla central de esta máquina de estados.
 *
 * Se puede retroceder un paso (QTY_CHECKED → DRAFT, CLIENT_APPROVED →
 * QTY_CHECKED) porque en la práctica la marca corrige después de haber
 * respondido. Lo que no se puede es deshacer un despacho: eso ya movió
 * mercancía y se corrige con una recepción o un ajuste, no borrando historia.
 */
const TRANSICIONES: Record<EstadoPedido, EstadoPedido[]> = {
  DRAFT: ['QTY_CHECKED', 'CANCELLED'],
  QTY_CHECKED: ['CLIENT_APPROVED', 'DRAFT', 'CANCELLED'],
  CLIENT_APPROVED: ['DISPATCHED', 'QTY_CHECKED', 'CANCELLED'],
  DISPATCHED: [],
  CANCELLED: [],
}

export const ETIQUETA: Record<EstadoPedido, string> = {
  DRAFT: 'Montado',
  QTY_CHECKED: 'Cantidades revisadas',
  CLIENT_APPROVED: 'Aprobado',
  DISPATCHED: 'Despachado',
  CANCELLED: 'Cancelado',
}

/** Qué acciones ofrecer en la bandeja para un pedido en este estado. */
export function transicionesPermitidas(desde: EstadoPedido): EstadoPedido[] {
  return TRANSICIONES[desde] ?? []
}

export function puedeTransicionar(desde: EstadoPedido, a: EstadoPedido): boolean {
  return transicionesPermitidas(desde).includes(a)
}

/**
 * Mensaje de rechazo. Se construye aquí y no en la capa de datos para que el
 * texto que ve el usuario sea testeable sin base de datos.
 */
export function motivoRechazo(code: string, desde: EstadoPedido, a: EstadoPedido): string {
  const permitidas = transicionesPermitidas(desde)
  return (
    `El pedido ${code} está en ${ETIQUETA[desde]} y no puede pasar a ${ETIQUETA[a]}. ` +
    `Transiciones válidas: ${permitidas.map((t) => ETIQUETA[t]).join(', ') || 'ninguna'}.`
  )
}

/** El campo de fecha que se sella en cada transición — el lead time por tramo. */
export const CAMPO_FECHA: Partial<Record<EstadoPedido, string>> = {
  QTY_CHECKED: 'qty_checked_at',
  CLIENT_APPROVED: 'approved_at',
  DISPATCHED: 'dispatched_at',
}
