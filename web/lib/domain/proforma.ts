/**
 * Aritmética de la proforma.
 *
 * Todo en ENTEROS de centavos y todo puro: sin base de datos, sin DOM. Es la
 * única definición de cómo se calcula un total en el sistema, y la usan por
 * igual la pantalla y el servidor — si divergieran, el cliente vería un número
 * y se guardaría otro.
 *
 * REGLA DE REDONDEO: se redondea UNA sola vez por línea, al calcular su
 * descuento, y otra al descuento de pie. Nunca se redondea el precio unitario
 * ni se acumulan medios centavos: redondear en cada multiplicación intermedia
 * hace que el total no cuadre con la suma de las líneas impresas, que es
 * justo lo que un cliente detecta y reclama.
 */

export type LineaProforma = {
  /** Identificador temporal en la pantalla, o el id real si ya está guardada. */
  key: string
  variantId: number
  sku: string
  descripcion: string
  tallaLabel: string
  disponible: number
  cantidad: number
  precioCents: number
  descuentoPct: number
}

export type TotalesLinea = {
  brutoCents: number
  descuentoCents: number
  netoCents: number
}

export type TotalesProforma = {
  subtotalCents: number
  descuentoLineasCents: number
  baseCents: number
  descuentoPieCents: number
  totalCents: number
  unidades: number
  lineas: number
}

/** Redondeo comercial a centavo entero: mitad hacia arriba. */
function redondear(n: number): number {
  return Math.round(n)
}

export function totalesDeLinea(l: {
  cantidad: number
  precioCents: number
  descuentoPct: number
}): TotalesLinea {
  const brutoCents = Math.max(0, l.cantidad) * Math.max(0, l.precioCents)
  const pct = Math.min(100, Math.max(0, l.descuentoPct))
  const descuentoCents = redondear((brutoCents * pct) / 100)
  return { brutoCents, descuentoCents, netoCents: brutoCents - descuentoCents }
}

/**
 * Totales del documento.
 *
 * `subtotal` es la suma BRUTA, antes de cualquier descuento — es la cifra que
 * el cliente reconoce como "lista de precios". Después baja el descuento de
 * las líneas, y sobre esa base cae el descuento de pie. Ese orden importa: al
 * revés, el descuento de pie se aplicaría sobre importes que ya no existen.
 */
export function totalesDeProforma(
  lineas: { cantidad: number; precioCents: number; descuentoPct: number }[],
  descuentoPiePct: number
): TotalesProforma {
  let subtotalCents = 0
  let descuentoLineasCents = 0
  let unidades = 0
  let conCantidad = 0

  for (const l of lineas) {
    if (l.cantidad <= 0) continue
    const t = totalesDeLinea(l)
    subtotalCents += t.brutoCents
    descuentoLineasCents += t.descuentoCents
    unidades += l.cantidad
    conCantidad++
  }

  const baseCents = subtotalCents - descuentoLineasCents
  const piePct = Math.min(100, Math.max(0, descuentoPiePct))
  const descuentoPieCents = redondear((baseCents * piePct) / 100)

  return {
    subtotalCents,
    descuentoLineasCents,
    baseCents,
    descuentoPieCents,
    totalCents: baseCents - descuentoPieCents,
    unidades,
    lineas: conCantidad,
  }
}

/** Formato de moneda para pantalla. COP no usa decimales en la práctica. */
export function pesos(cents: number): string {
  return (cents / 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })
}

export type ProblemaProforma = { linea: LineaProforma; motivo: string }

/**
 * Qué impide emitir la proforma.
 *
 * Es ayuda de interfaz, NO la garantía: entre que se pinta esta pantalla y se
 * reserva, otro vendedor pudo comprometer el mismo par. La garantía real es el
 * update atómico al reservar (CLAUDE.md §5).
 */
export function validarProforma(lineas: LineaProforma[]): {
  ok: boolean
  problemas: ProblemaProforma[]
  conCantidad: LineaProforma[]
} {
  const conCantidad = lineas.filter((l) => l.cantidad > 0)
  const problemas: ProblemaProforma[] = []

  for (const l of conCantidad) {
    if (l.cantidad > l.disponible) {
      problemas.push({
        linea: l,
        motivo: `pide ${l.cantidad} y hay ${l.disponible} disponible(s)`,
      })
    }
    if (l.precioCents <= 0) {
      problemas.push({ linea: l, motivo: 'sin precio unitario' })
    }
  }

  return { ok: conCantidad.length > 0 && problemas.length === 0, problemas, conCantidad }
}
