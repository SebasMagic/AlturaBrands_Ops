export type CurvaEntry = { sizeLabel: string; sizeValue: number; ratio: number }
export type Curva = {
  code: string
  name: string
  scale: string
  pairsPerPack: number
  isDefault: boolean
  entries: CurvaEntry[]
}

export type TallaInfo = { sku: string; disponible: number; propio: number; transito: number }
export type MaterialPedido = {
  material: string
  descripcion: string
  modelo: string
  genero: string
  categoria: string | null
  color: string
  escala: string
  msrpUsd: number | null
  costoUsdCents: number | null
  disponibleTotal: number
  propioTotal: number
  transitoTotal: number
  tallas: Record<string, TallaInfo>
}

/** Estado de una línea del pedido, tal como vive en el estado del cliente. */
export type Linea = {
  packs: number
  curva: string
  /** Cantidades por talla. Solo presente si el usuario tocó alguna celda. */
  override?: Record<string, number>
}

/**
 * Cantidades de una línea: curva × bultos, con los ajustes aplicados encima.
 *
 * Pura y sin DOM ni base de datos — es exactamente la regla de negocio que
 * hay que poder testear sola (CLAUDE.md §7): "bultos × curva = cantidades",
 * y un ajuste a mano gana sobre lo calculado.
 */
export function cantidades(
  linea: Linea | undefined,
  curva: Curva | undefined
): Record<string, number> {
  if (!linea || linea.packs <= 0) return linea?.override ?? {}
  const base: Record<string, number> = {}
  for (const e of curva?.entries ?? []) {
    base[e.sizeLabel] = e.ratio * linea.packs
  }
  return { ...base, ...(linea.override ?? {}) }
}

/** Curva sugerida: la marcada por defecto para la escala del material; si no hay, la primera de esa escala. */
export function curvaSugerida(curvas: Curva[], escala: string): string {
  return (
    curvas.find((c) => c.scale === escala && c.isDefault)?.code ??
    curvas.find((c) => c.scale === escala)?.code ??
    ''
  )
}

export type ResumenPedido = {
  items: number
  packs: number
  pares: number
  costoUsdCents: number
  excesos: number
}

/**
 * Resumen del pedido en construcción, sobre las líneas tocadas por el
 * comprador. `excesos` cuenta tallas donde se pide más de lo que hay
 * disponible en la marca — la única señal roja de esta pantalla
 * (CLAUDE.md §8: "color con significado, no decorativo").
 */
export function calcularResumenPedido(
  materiales: MaterialPedido[],
  lineas: Record<string, Linea>,
  curvasPorCodigo: Map<string, Curva>
): ResumenPedido {
  let items = 0
  let packs = 0
  let pares = 0
  let costoUsdCents = 0
  let excesos = 0

  for (const mat of materiales) {
    const linea = lineas[mat.material]
    if (!linea) continue
    const qty = cantidades(linea, curvasPorCodigo.get(linea.curva))
    const total = Object.values(qty).reduce((a, b) => a + b, 0)
    if (total <= 0) continue

    items++
    packs += linea.packs
    pares += total
    costoUsdCents += (mat.costoUsdCents ?? 0) * total

    for (const [talla, q] of Object.entries(qty)) {
      if (q > (mat.tallas[talla]?.disponible ?? 0)) excesos++
    }
  }

  return { items, packs, pares, costoUsdCents, excesos }
}
