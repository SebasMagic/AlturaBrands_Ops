import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

/**
 * Pone nombre de producto a los inventory items.
 *
 * Medusa deriva el título del inventory item del título de la variante, y en
 * nuestro modelo la variante es la talla. Resultado: los 3.064 items se
 * llamaban "M 7", "M 7.5"… sin decir de qué producto son. Eso se ve en la
 * lista de inventario, en el selector de reservas y en las líneas de pedido,
 * donde no hay forma de saber qué se está tocando.
 *
 * Pasa a "NEWPORT · BISON · M 7". También se rellena `thumbnail`, que existía
 * y estaba vacío en los 3.064.
 *
 * Es una mutación de metadatos, no de existencias: no mueve un solo par, así
 * que no necesita workflow (CLAUDE.md §6 exige workflow para mutar inventario,
 * y esto no lo es). Idempotente: recalcula el título desde el maestro, así que
 * volver a correrlo corrige en vez de acumular.
 *
 *   pnpm exec medusa exec ./src/scripts/fix-inventory-titles.ts
 */

const LOTE = 100

export default async function fixInventoryTitles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const inventoryService = container.resolve(Modules.INVENTORY)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  // El nombre bonito y la foto salen del maestro y del producto, cruzados por
  // material. El SKU es "<material>-<escala><talla>", así que el material es
  // lo que va antes del primer guion.
  const datos = await knex.raw(
    `select v.sku,
            v.modelo,
            v.color,
            v.talla_label,
            v.genero,
            pr.thumbnail
     from bi.v_posicion v
     left join product pr
       on pr.metadata->>'material' = v.material
      and pr.deleted_at is null
     where v.operacion = 'CO'`
  )

  const porSku = new Map<string, any>(
    (datos.rows ?? []).map((r: any) => [String(r.sku), r])
  )
  logger.info(`Maestro: ${porSku.size} SKU con nombre de producto`)

  const items = await inventoryService.listInventoryItems(
    {},
    { select: ['id', 'sku', 'title', 'thumbnail'] }
  )
  logger.info(`Inventario: ${items.length} items`)

  const cambios: { id: string; title: string; thumbnail?: string }[] = []
  const huerfanos: string[] = []

  for (const it of items as any[]) {
    const d = porSku.get(String(it.sku))
    if (!d) {
      huerfanos.push(it.sku)
      continue
    }

    const title = [d.modelo, d.color, d.talla_label]
      .filter(Boolean)
      .join(' · ')

    const mismoTitulo = it.title === title
    const mismaFoto = (it.thumbnail ?? null) === (d.thumbnail ?? null)
    if (mismoTitulo && mismaFoto) continue

    cambios.push({
      id: it.id,
      title,
      ...(d.thumbnail ? { thumbnail: d.thumbnail } : {}),
    })
  }

  if (huerfanos.length) {
    logger.warn(
      `${huerfanos.length} items sin correspondencia en el maestro ` +
        `(se dejan como están): ${huerfanos.slice(0, 5).join(', ')}` +
        (huerfanos.length > 5 ? '…' : '')
    )
  }

  logger.info(`Por actualizar: ${cambios.length}`)
  if (cambios.length === 0) {
    logger.info('Nada que hacer, los títulos ya están bien.')
    return
  }

  let hechos = 0
  for (let i = 0; i < cambios.length; i += LOTE) {
    const lote = cambios.slice(i, i + LOTE)
    await inventoryService.updateInventoryItems(lote as any)
    hechos += lote.length
    logger.info(`  ${hechos}/${cambios.length}`)
  }

  // --- Verificación ------------------------------------------------------
  const final = await knex.raw(
    `select count(*)::int                     as total,
            count(thumbnail)::int             as con_foto,
            count(*) filter (where title like '%·%')::int as con_nombre
     from inventory_item where deleted_at is null`
  )
  const f = final.rows[0]

  const muestra = await knex.raw(
    `select sku, title from inventory_item
     where sku like '1001870-%' and deleted_at is null
     order by sku limit 3`
  )

  logger.info('')
  logger.info('--- Resultado ---')
  logger.info(`Items                : ${f.total}`)
  logger.info(`  con nombre completo: ${f.con_nombre}`)
  logger.info(`  con foto           : ${f.con_foto}`)
  logger.info('Muestra:')
  ;(muestra.rows ?? []).forEach((r: any) =>
    logger.info(`  ${r.sku}  →  ${r.title}`)
  )
}
