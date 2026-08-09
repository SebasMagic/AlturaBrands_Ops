import fs from 'node:fs'
import path from 'node:path'

import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

import { BRAND_MODULE } from '../modules/brand'
import { SIZE_CURVE_MODULE } from '../modules/size-curve'

/**
 * Carga las curvas de tallas inferidas del formato de pedido de la marca.
 *
 * Fuente: data/size-curves.json, producido por etl/extract_size_curves.py.
 * Idempotente por `code`.
 *
 *   pnpm exec medusa exec ./src/scripts/load-size-curves.ts
 */

type Entry = { size_label: string; size_value: number; ratio: number }
type Curva = {
  code: string
  name: string
  brand_code: string
  scale: string
  pairs_per_pack: number
  is_default: boolean
  usos_observados: number
  modelos_observados: string[]
  entries: Entry[]
}

export default async function loadSizeCurves({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const curveService: any = container.resolve(SIZE_CURVE_MODULE)
  const brandService: any = container.resolve(BRAND_MODULE)

  const jsonPath = path.join(process.cwd(), 'data', 'size-curves.json')
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `No existe ${jsonPath}. Genéralo antes: python etl/extract_size_curves.py`
    )
  }
  const curvas: Curva[] = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  logger.info(`Curvas en el archivo: ${curvas.length}`)

  const existentes = await curveService.listSizeCurves({}, { select: ['id', 'code'] })
  const porCodigo = new Map<string, string>(
    existentes.map((c: any) => [c.code as string, c.id as string])
  )

  // Refresco, no "omitir si existe": el JSON es una instantánea del formato de
  // pedido y puede reextraerse. Las tallas de cada curva se reemplazan enteras,
  // así una corrección en el origen llega hasta la base sin pasos manuales.
  let creadas = 0
  let refrescadas = 0

  for (const c of curvas) {
    const datos = {
      code: c.code,
      name: c.name,
      scale: c.scale,
      pairs_per_pack: c.pairs_per_pack,
      is_default: c.is_default,
      is_active: true,
    }

    let curvaId = porCodigo.get(c.code)
    if (!curvaId) {
      const creada = await curveService.createSizeCurves(datos)
      curvaId = creada.id
      creadas++
    } else {
      await curveService.updateSizeCurves({ id: curvaId, ...datos })
      const viejas = await curveService.listSizeCurveEntries(
        { curve_id: curvaId },
        { select: ['id'] }
      )
      if (viejas.length) {
        await curveService.deleteSizeCurveEntries(viejas.map((e: any) => e.id))
      }
      refrescadas++
    }

    await curveService.createSizeCurveEntries(
      c.entries.map((e) => ({
        size_label: e.size_label,
        size_value: e.size_value,
        ratio: e.ratio,
        curve_id: curvaId,
      }))
    )

    // La curva pertenece a la marca: es parte de sus reglas de pedido.
    const [brand] = await brandService.listBrands({ code: c.brand_code })
    if (brand) {
      await link.create({
        [BRAND_MODULE]: { brand_id: brand.id },
        [SIZE_CURVE_MODULE]: { size_curve_id: curvaId },
      })
    }

    logger.info(
      `  ${c.code}  ${c.pairs_per_pack} pares/bulto  ${c.entries.length} tallas` +
        (c.is_default ? '  (por defecto)' : '')
    )
  }
  logger.info(`Curvas creadas: ${creadas} · refrescadas: ${refrescadas}`)

  // Curvas que ya no vienen en el origen: se desactivan, no se borran. Un
  // pedido pasado pudo usarlas, y perder esa referencia haría irreproducible
  // por qué se pidió lo que se pidió.
  const enOrigen = new Set(curvas.map((c) => c.code))
  const sobrantes = existentes.filter((c: any) => !enOrigen.has(c.code))
  if (sobrantes.length) {
    for (const s of sobrantes) {
      await curveService.updateSizeCurves({ id: s.id, is_active: false })
    }
    logger.info(
      `Desactivadas (ya no están en el origen): ${sobrantes
        .map((s: any) => s.code)
        .join(', ')}`
    )
  }

  // --- Verificación ------------------------------------------------------
  // Solo las activas: las desactivadas se conservan por trazabilidad y no
  // deben contar contra lo que trae el origen.
  const todas = await curveService.listSizeCurves(
    { is_active: true },
    { select: ['id', 'code', 'scale', 'pairs_per_pack', 'is_default'] }
  )
  const inactivas = await curveService.listSizeCurves(
    { is_active: false },
    { select: ['id', 'code'] }
  )
  const entries = await curveService.listSizeCurveEntries(
    { curve_id: todas.map((c: any) => c.id) },
    { select: ['id'] }
  )

  const esperadoEntries = curvas.reduce((a, c) => a + c.entries.length, 0)
  const esperadoPares = curvas.reduce((a, c) => a + c.pairs_per_pack, 0)
  const realPares = todas.reduce((a: number, c: any) => a + Number(c.pairs_per_pack), 0)

  const ok = (a: number, b: number) => (a === b ? 'OK' : `ESPERADO ${b}  <-- REVISAR`)

  logger.info('')
  logger.info('--- Verificación ---')
  logger.info(`Curvas activas  : ${todas.length}  ${ok(todas.length, curvas.length)}`)
  logger.info(`Tallas (entries): ${entries.length}  ${ok(entries.length, esperadoEntries)}`)
  logger.info(`Suma pares/bulto: ${realPares}  ${ok(realPares, esperadoPares)}`)
  logger.info(`Inactivas       : ${inactivas.length} (conservadas por trazabilidad)`)

  const porEscala: Record<string, number> = {}
  todas.forEach((c: any) => {
    porEscala[c.scale] = (porEscala[c.scale] ?? 0) + 1
  })
  logger.info(
    `Por escala      : ${Object.entries(porEscala)
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ')}`
  )
}
