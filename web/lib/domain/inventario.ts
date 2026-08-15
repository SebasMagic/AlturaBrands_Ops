import type { MaterialFila } from '@/lib/db/inventario'

export type Resumen = {
  materiales: number
  sinStockPropio: number
  propio: number
  reservado: number
  transito: number
  proveedor: number
}

/**
 * El resumen se calcula sobre lo FILTRADO, no sobre todo el catálogo: las
 * tarjetas resumen lo que el usuario está mirando, que es lo que espera.
 *
 * Función pura — se testea sin base de datos, tal como pide CLAUDE.md §7:
 * "las reglas viven en lib/domain/".
 */
export function calcularResumen(materiales: MaterialFila[]): Resumen {
  const suma = (f: (m: MaterialFila) => number) =>
    materiales.reduce((acc, m) => acc + f(m), 0)

  return {
    materiales: materiales.length,
    sinStockPropio: materiales.filter((m) => m.propio === 0).length,
    propio: suma((m) => m.propio),
    reservado: suma((m) => m.reservado),
    transito: suma((m) => m.transito),
    proveedor: suma((m) => m.proveedor),
  }
}

/**
 * La tarjeta "Por pedir en la marca" puede nombrar la marca solo cuando hay
 * una sola en juego: porque está filtrada, o porque el catálogo todavía no
 * tiene más. Con varias a la vez el total suma marcas distintas y no puede
 * nombrar ninguna.
 */
export function elegirMarcaEnJuego(
  marcaFiltrada: string | undefined,
  marcasDisponibles: string[]
): string | null {
  if (marcaFiltrada) return marcaFiltrada
  if (marcasDisponibles.length === 1) return marcasDisponibles[0] ?? null
  return null
}
