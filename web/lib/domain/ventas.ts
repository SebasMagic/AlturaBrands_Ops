export type EstadoVenta = 'COTIZACION' | 'CONFIRMADO' | 'CANCELADO'
export type EstadoDespacho = 'ALISTANDO' | 'EMPACADO' | 'DESPACHADO' | 'ENTREGADO' | 'CANCELADO'

export const ETIQUETA_VENTA: Record<EstadoVenta, string> = {
  COTIZACION: 'Cotización',
  CONFIRMADO: 'Confirmado',
  CANCELADO: 'Cancelado',
}

export const ETIQUETA_DESPACHO: Record<EstadoDespacho, string> = {
  ALISTANDO: 'Alistando',
  EMPACADO: 'Empacado',
  DESPACHADO: 'Despachado',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
}

/**
 * Transiciones del despacho.
 *
 * DESPACHADO es irreversible a propósito: ahí la mercancía SALIÓ físicamente y
 * el stock ya se descontó con su asiento en el kardex. Un error se corrige con
 * una devolución o un ajuste, que dejan su propio rastro — nunca borrando
 * historia (CLAUDE.md §6).
 */
const TRANSICIONES_DESPACHO: Record<EstadoDespacho, EstadoDespacho[]> = {
  ALISTANDO: ['EMPACADO', 'CANCELADO'],
  EMPACADO: ['DESPACHADO', 'ALISTANDO', 'CANCELADO'],
  DESPACHADO: ['ENTREGADO'],
  ENTREGADO: [],
  CANCELADO: [],
}

export function transicionesDespacho(desde: EstadoDespacho): EstadoDespacho[] {
  return TRANSICIONES_DESPACHO[desde] ?? []
}

export function puedeDespachar(desde: EstadoDespacho, a: EstadoDespacho): boolean {
  return transicionesDespacho(desde).includes(a)
}

export type LineaVentaBorrador = {
  variantId: number
  sku: string
  sizeLabel: string
  cantidad: number
  disponible: number
  precioCents: number
}

/**
 * Un borrador es válido si tiene al menos una línea con cantidad y ninguna
 * pide más de lo disponible.
 *
 * Ojo: esto es una ayuda de interfaz, NO la garantía. La garantía real es el
 * update atómico con `qty - reserved >= n` al reservar (CLAUDE.md §5) — entre
 * que se pinta esta pantalla y se confirma, otro vendedor pudo comprometer el
 * mismo par.
 */
export function validarBorrador(lineas: LineaVentaBorrador[]): {
  ok: boolean
  conCantidad: LineaVentaBorrador[]
  excedidas: LineaVentaBorrador[]
} {
  const conCantidad = lineas.filter((l) => l.cantidad > 0)
  const excedidas = conCantidad.filter((l) => l.cantidad > l.disponible)
  return { ok: conCantidad.length > 0 && excedidas.length === 0, conCantidad, excedidas }
}

export function totalBorradorCents(lineas: LineaVentaBorrador[]): number {
  return lineas.reduce((a, l) => a + l.cantidad * l.precioCents, 0)
}
