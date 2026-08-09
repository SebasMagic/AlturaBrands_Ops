import fs from 'node:fs'
import path from 'node:path'

import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

/**
 * Exporta los productos que aún no tienen foto.
 *
 * Sale ordenado por disponibilidad en la marca, de mayor a menor: si hay que
 * conseguir 265 fotos, conviene empezar por lo que de verdad se puede vender,
 * no por orden alfabético.
 *
 * Genera JSON para el paso siguiente del ETL y un CSV con BOM para que Excel
 * abra bien los acentos al hacer doble clic.
 *
 *   pnpm exec medusa exec ./src/scripts/export-productos-sin-foto.ts
 */

export default async function exportSinFoto({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const productos = await productService.listProducts(
    {},
    { select: ['id', 'title', 'handle', 'metadata'], relations: ['images'] }
  )
  const sinFoto = productos.filter((p: any) => (p.images ?? []).length === 0)
  logger.info(`Productos sin foto: ${sinFoto.length} de ${productos.length}`)

  // Disponibilidad por material, para poder priorizar.
  const disp = await knex.raw(
    `select material,
            sum(en_proveedor)::int as por_pedir,
            sum(propio)::int       as en_bodega,
            sum(en_transito)::int  as en_transito
     from bi.v_posicion
     group by material`
  )
  const porMaterial = new Map<string, any>(
    (disp.rows ?? []).map((r: any) => [String(r.material), r])
  )

  const filas = sinFoto
    .map((p: any) => {
      const m = String(p.metadata?.material ?? '')
      const d = porMaterial.get(m) ?? {}
      return {
        material: m,
        modelo: p.metadata?.modelo ?? '',
        color: p.metadata?.color ?? '',
        genero: p.metadata?.genero ?? '',
        categoria: p.metadata?.categoria ?? '',
        descripcion: p.title,
        por_pedir: Number(d.por_pedir ?? 0),
        en_bodega: Number(d.en_bodega ?? 0),
        en_transito: Number(d.en_transito ?? 0),
      }
    })
    // Lo más comprable primero: es donde una foto rinde antes.
    .sort(
      (a, b) =>
        b.por_pedir - a.por_pedir ||
        a.modelo.localeCompare(b.modelo) ||
        a.color.localeCompare(b.color)
    )

  const dir = path.join(process.cwd(), 'data')
  fs.writeFileSync(
    path.join(dir, 'productos-sin-foto.json'),
    JSON.stringify(filas, null, 2),
    'utf8'
  )

  // BOM al inicio: sin él, Excel abre el CSV en la codificación del sistema y
  // parte los acentos.
  const cols = Object.keys(filas[0] ?? {})
  const csv = [
    cols.join(';'),
    ...filas.map((f: any) =>
      cols.map((c) => String(f[c] ?? '').replace(/;/g, ',')).join(';')
    ),
  ].join('\r\n')
  fs.writeFileSync(path.join(dir, 'productos-sin-foto.csv'), '﻿' + csv, 'utf8')

  // --- Resumen -----------------------------------------------------------
  const porModelo = new Map<string, number>()
  filas.forEach((f) => {
    const k = `${f.modelo} (${f.genero})`
    porModelo.set(k, (porModelo.get(k) ?? 0) + 1)
  })
  const top = [...porModelo.entries()].sort((a, b) => b[1] - a[1])

  logger.info('')
  logger.info(`Modelos afectados: ${porModelo.size}`)
  logger.info(`Pares comprables sin foto: ${filas.reduce((a, f) => a + f.por_pedir, 0)}`)
  logger.info('')
  logger.info('--- Top 15 por número de colores sin foto ---')
  top.slice(0, 15).forEach(([k, n]) => logger.info(`  ${String(n).padStart(2)} colores · ${k}`))
  logger.info('')
  logger.info('Escrito: data/productos-sin-foto.csv  y  .json')
}
