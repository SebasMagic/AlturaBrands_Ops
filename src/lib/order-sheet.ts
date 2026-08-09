import ExcelJS from 'exceljs'

/**
 * Lee un Excel con el layout de pedido de la marca y lo normaliza.
 *
 * Es la ÚNICA implementación de este parseo: la usa tanto la subida desde el
 * admin como cualquier script. Tener dos versiones de la misma lectura es
 * garantizar que un día discrepen y nadie sepa cuál manda.
 *
 * No inventa cantidades. Si una fila no encaja con ninguna curva activa, la
 * acepta igualmente y la marca como ajustada — el comprador tiene derecho a
 * pedir lo que quiera; lo que no puede es que el sistema lo interprete mal.
 */

export type CurvaConocida = {
  code: string
  scale: string
  entries: { size_label: string; ratio: number }[]
}

export type ItemLeido = {
  material_code: string
  description: string
  size_curve_code: string | null
  packs: number
  is_adjusted: boolean
  adjustment_note: string | null
  unit_cost_cents: number | null
  sizes: {
    sku: string
    size_label: string
    size_value: number
    quantity_requested: number
  }[]
}

export type ResultadoLectura = {
  items: ItemLeido[]
  avisos: string[]
  errores: string[]
  resumen: { filas: number; items: number; packs: number; pares: number }
}

const ESCALA: Record<string, string> = {
  MEN: 'M',
  WOMEN: 'W',
  CHILDREN: 'C',
  YOUTH: 'Y',
  TOTS: 'T',
}

const COL_BULTOS = 'bultos'
const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

const numero = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null
  // ExcelJS devuelve objetos para celdas con fórmula
  const bruto = typeof v === 'object' && 'result' in v ? v.result : v
  const n = typeof bruto === 'number' ? bruto : parseFloat(String(bruto))
  return Number.isFinite(n) ? n : null
}

export async function leerHojaDePedido(
  buffer: Buffer,
  curvas: CurvaConocida[]
): Promise<ResultadoLectura> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as any)

  const ws = wb.worksheets[0]
  if (!ws) {
    return {
      items: [],
      avisos: [],
      errores: ['El archivo no tiene ninguna hoja.'],
      resumen: { filas: 0, items: 0, packs: 0, pares: 0 },
    }
  }

  // --- Cabecera ----------------------------------------------------------
  const cabecera = ws.getRow(1)
  const columnas = new Map<string, number>()
  const tallas: { col: number; label: string; value: number }[] = []

  cabecera.eachCell((cell, col) => {
    const bruto = String(cell.value ?? '').trim()
    const n = parseFloat(bruto)
    // Una cabecera que es un número es una columna de talla
    if (!Number.isNaN(n) && /^\d+(\.\d+)?$/.test(bruto)) {
      tallas.push({ col, label: bruto, value: n })
    } else {
      columnas.set(norm(bruto), col)
    }
  })

  const errores: string[] = []
  const buscar = (...alias: string[]) => {
    for (const a of alias) {
      for (const [k, v] of columnas) if (k.includes(a)) return v
    }
    return null
  }

  const colMaterial = buscar('material') // "Material", no "Descripcion material"
  const colDesc = buscar('descripcion material', 'descripcion')
  const colGenero = buscar('genero')
  const colBultos = buscar(COL_BULTOS)
  const colPrecio = buscar('precio pa')

  if (!colMaterial) errores.push('Falta la columna "Material".')
  if (!colGenero) errores.push('Falta la columna "Genero".')
  if (!colBultos) errores.push('Falta la columna "Bultos".')
  if (tallas.length === 0) errores.push('No se encontró ninguna columna de talla.')

  if (errores.length) {
    return {
      items: [],
      avisos: [],
      errores,
      resumen: { filas: 0, items: 0, packs: 0, pares: 0 },
    }
  }

  // --- Filas ------------------------------------------------------------
  const avisos: string[] = []
  const items: ItemLeido[] = []
  let filasLeidas = 0

  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i)
    const material = numero(row.getCell(colMaterial!).value)
    const packs = numero(row.getCell(colBultos!).value)
    const genero = String(row.getCell(colGenero!).value ?? '').trim().toUpperCase()

    if (material === null || !packs || packs <= 0) continue
    filasLeidas++

    const escala = ESCALA[genero]
    if (!escala) {
      avisos.push(`Fila ${i}: género "${genero}" desconocido, se omite.`)
      continue
    }

    const cantidades: { label: string; value: number; qty: number }[] = []
    for (const t of tallas) {
      const q = numero(row.getCell(t.col).value)
      if (q && q > 0) cantidades.push({ label: t.label, value: t.value, qty: q })
    }
    if (cantidades.length === 0) {
      avisos.push(`Fila ${i}: material ${material} tiene bultos pero ninguna talla.`)
      continue
    }

    // --- Qué curva se usó, y si se ajustó ------------------------------
    let curvaCode: string | null = null
    let nota: string | null = null

    const porBulto: Record<string, number> = {}
    let exacta = true
    for (const c of cantidades) {
      const ratio = c.qty / packs
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        exacta = false
        break
      }
      porBulto[c.label] = Math.round(ratio)
    }

    if (exacta) {
      for (const curva of curvas.filter((c) => c.scale === escala)) {
        const receta = Object.fromEntries(
          curva.entries.map((e) => [e.size_label, e.ratio])
        )
        const sobra = Object.keys(porBulto).some((k) => !(k in receta))
        if (sobra) continue
        if (Object.entries(porBulto).every(([k, v]) => receta[k] === v)) {
          curvaCode = curva.code
          const quitadas = Object.keys(receta).filter((k) => !(k in porBulto))
          if (quitadas.length) {
            nota = `Se quitaron las tallas ${quitadas.join(', ')}`
          }
          break
        }
      }
    }

    if (!curvaCode) {
      nota =
        nota ??
        (exacta
          ? 'Las cantidades no coinciden con ninguna curva activa'
          : 'Las cantidades no son múltiplo exacto de los bultos')
      avisos.push(`Fila ${i}: material ${material} — ${nota.toLowerCase()}.`)
    }

    const precio = colPrecio ? numero(row.getCell(colPrecio).value) : null
    const desc = colDesc ? String(row.getCell(colDesc).value ?? '').trim() : ''

    items.push({
      material_code: String(material),
      description: desc || `MATERIAL ${material}`,
      size_curve_code: curvaCode,
      packs: Math.round(packs),
      is_adjusted: !curvaCode || nota !== null,
      adjustment_note: nota,
      unit_cost_cents: precio === null ? null : Math.round(precio * 100),
      sizes: cantidades
        .sort((a, b) => a.value - b.value)
        .map((c) => ({
          sku: `${material}-${escala}${c.label}`,
          size_label: c.label,
          size_value: c.value,
          quantity_requested: Math.round(c.qty),
        })),
    })
  }

  const pares = items.reduce(
    (a, i) => a + i.sizes.reduce((b, s) => b + s.quantity_requested, 0),
    0
  )
  const packs = items.reduce((a, i) => a + i.packs, 0)

  return {
    items,
    avisos,
    errores,
    resumen: { filas: filasLeidas, items: items.length, packs, pares },
  }
}
