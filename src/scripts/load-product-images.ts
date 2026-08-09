import fs from 'node:fs'
import path from 'node:path'

import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

/**
 * Asocia las fotos de producto al catálogo.
 *
 * Fuente: data/imagenes-productos.json, producido por el cruce del CSV de
 * Shopify contra el maestro. Ese CSV no trae SKU ni material, así que la
 * pareja se hizo por modelo + color + género — ver el script del ETL.
 *
 * Las URLs apuntan al CDN de Shopify. Funcionan hoy, pero son de un dominio
 * que no controlamos: si esa tienda cierra, las fotos desaparecen sin aviso.
 * Migrarlas a Supabase Storage queda pendiente y es transparente para el
 * catálogo, porque solo cambia la dirección.
 *
 * Idempotente: reasigna siempre desde el JSON, así una corrección en el cruce
 * llega hasta la base sin pasos manuales.
 *
 *   pnpm exec medusa exec ./src/scripts/load-product-images.ts
 */

type Emparejado = {
  material: string
  modelo: string
  color: string
  genero: string
  score: number
  imagenes: string[]
}

const LOTE = 20

export default async function loadProductImages({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT)

  const jsonPath = path.join(process.cwd(), 'data', 'imagenes-productos.json')
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `No existe ${jsonPath}. Genera el cruce antes con el script de ETL.`
    )
  }
  const emparejados: Emparejado[] = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  logger.info(
    `Origen: ${emparejados.length} materiales con foto, ` +
      `${emparejados.reduce((a, e) => a + e.imagenes.length, 0)} imágenes`
  )

  // --- Localizar los productos por su material ---------------------------
  const productos = await productService.listProducts(
    {},
    { select: ['id', 'title', 'metadata'] }
  )
  const porMaterial = new Map<string, any>()
  productos.forEach((p: any) => {
    const m = p.metadata?.material
    if (m) porMaterial.set(String(m), p)
  })
  logger.info(`Catálogo: ${porMaterial.size} materiales`)

  // --- Actualizar --------------------------------------------------------
  const actualizables = emparejados.filter(
    (e) => porMaterial.has(e.material) && e.imagenes.length > 0
  )
  const huerfanos = emparejados.filter((e) => !porMaterial.has(e.material))
  if (huerfanos.length) {
    logger.warn(
      `${huerfanos.length} materiales del cruce no existen en el catálogo: ` +
        huerfanos.map((h) => h.material).join(', ')
    )
  }

  let hechos = 0
  for (let i = 0; i < actualizables.length; i += LOTE) {
    const lote = actualizables.slice(i, i + LOTE)
    // La firma con selector evita tener que pasar el objeto entero por
    // producto: se actualiza uno a uno, que además deja el error acotado al
    // material que falle en vez de tumbar el lote.
    for (const e of lote) {
      await productService.updateProducts(porMaterial.get(e.material).id, {
        // La primera imagen hace de miniatura: es la que se ve en listados, y
        // en este origen viene ordenada por Image Position.
        thumbnail: e.imagenes[0],
        images: e.imagenes.map((url) => ({ url })),
      })
    }
    hechos += lote.length
    logger.info(`  ${hechos}/${actualizables.length} materiales con foto`)
  }

  // --- Verificación ------------------------------------------------------
  const finales = await productService.listProducts(
    {},
    { select: ['id', 'title', 'thumbnail', 'metadata'], relations: ['images'] }
  )
  const conFoto = finales.filter((p: any) => (p.images ?? []).length > 0)
  const sinFoto = finales.filter((p: any) => (p.images ?? []).length === 0)
  const totalImgs = conFoto.reduce((a: number, p: any) => a + p.images.length, 0)

  const ok = (a: number, b: number) => (a === b ? 'OK' : `ESPERADO ${b}  <-- REVISAR`)

  logger.info('')
  logger.info('--- Resultado ---')
  logger.info(`Productos con foto : ${conFoto.length}  ${ok(conFoto.length, actualizables.length)}`)
  logger.info(`Imágenes cargadas  : ${totalImgs}`)
  logger.info(`Productos SIN foto : ${sinFoto.length} de ${finales.length}`)

  // --- Qué falta, agrupado por modelo para poder buscarlo ----------------
  const faltantesPorModelo = new Map<string, { genero: string; colores: string[] }>()
  sinFoto.forEach((p: any) => {
    const modelo = p.metadata?.modelo ?? '(sin modelo)'
    const genero = p.metadata?.genero ?? ''
    const color = p.metadata?.color ?? '(sin color)'
    const clave = `${modelo}|${genero}`
    if (!faltantesPorModelo.has(clave)) {
      faltantesPorModelo.set(clave, { genero, colores: [] })
    }
    faltantesPorModelo.get(clave)!.colores.push(color)
  })

  const ordenados = [...faltantesPorModelo.entries()].sort(
    (a, b) => b[1].colores.length - a[1].colores.length
  )

  logger.info('')
  logger.info(`--- Modelos sin foto: ${ordenados.length} ---`)
  ordenados.slice(0, 25).forEach(([clave, v]) => {
    const [modelo] = clave.split('|')
    logger.info(`  ${String(v.colores.length).padStart(2)} colores · ${modelo} (${v.genero})`)
  })
  if (ordenados.length > 25) {
    logger.info(`  ... y ${ordenados.length - 25} modelos más`)
  }

  // Se deja el listado completo en disco para poder pedírselo a la marca.
  const reporte = path.join(process.cwd(), 'data', 'productos-sin-foto.txt')
  const lineas = [
    `Productos sin foto: ${sinFoto.length} de ${finales.length}`,
    `Modelos afectados: ${ordenados.length}`,
    '',
    ...ordenados.map(([clave, v]) => {
      const [modelo] = clave.split('|')
      return `${modelo} (${v.genero})\n${v.colores.map((c) => `    ${c}`).join('\n')}`
    }),
  ]
  fs.writeFileSync(reporte, lineas.join('\n'), 'utf8')
  logger.info('')
  logger.info(`Listado completo escrito en: data/productos-sin-foto.txt`)
}
