import { ExecArgs } from '@medusajs/framework/types'
import { Modules } from '@medusajs/framework/utils'
import {
  deleteProductCategoriesWorkflow,
  deleteProductsWorkflow,
  deleteRegionsWorkflow,
  deleteStockLocationsWorkflow,
} from '@medusajs/medusa/core-flows'

/**
 * Elimina los datos de ejemplo que sembró el starter `dtc-starter`.
 *
 * Se acota por handle y nombre exactos a propósito: este script convivirá con
 * el catálogo real, y un borrado por criterio amplio ("todos los productos")
 * sería una bomba de relojería en cuanto alguien lo ejecute por costumbre.
 *
 * Idempotente: si ya no hay nada que borrar, no falla.
 *
 *   pnpm exec medusa exec ./src/scripts/purge-demo-data.ts
 */

const DEMO_PRODUCT_HANDLES = ['t-shirt', 'sweatshirt', 'sweatpants', 'shorts']
const DEMO_STOCK_LOCATIONS = ['European Warehouse']
const DEMO_CATEGORY_HANDLES = ['shirts', 'sweatshirts', 'pants', 'merch']
// La región de demo está en EUR. El catálogo maestro viene en USD, así que
// esta región no sirve para nada y solo confundiría al elegir moneda.
const DEMO_REGIONS = ['Europe']
const DEMO_CHANNELS = ['Default Sales Channel']
const DEMO_PROFILES = ['Default Shipping Profile']

export default async function purgeDemoData({ container }: ExecArgs) {
  const logger = container.resolve('logger')
  const productService = container.resolve(Modules.PRODUCT)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)

  // --- Productos de demo -------------------------------------------------
  const products = await productService.listProducts({
    handle: DEMO_PRODUCT_HANDLES,
  })

  if (products.length === 0) {
    logger.info('Productos de demo: no hay nada que borrar.')
  } else {
    logger.info(
      `Productos de demo a borrar: ${products.map((p) => p.handle).join(', ')}`
    )
    // Vía workflow para que arrastre variantes, opciones y items de inventario
    // con su compensación (CLAUDE.md §4.3).
    await deleteProductsWorkflow(container).run({
      input: { ids: products.map((p) => p.id) },
    })
    logger.info(`Borrados ${products.length} productos de demo.`)
  }

  // --- Bodega de demo ----------------------------------------------------
  const locations = await stockLocationService.listStockLocations({
    name: DEMO_STOCK_LOCATIONS,
  })

  if (locations.length === 0) {
    logger.info('Bodegas de demo: no hay nada que borrar.')
  } else {
    logger.info(
      `Bodegas de demo a borrar: ${locations.map((l) => l.name).join(', ')}`
    )
    await deleteStockLocationsWorkflow(container).run({
      input: { ids: locations.map((l) => l.id) },
    })
    logger.info(`Borradas ${locations.length} bodegas de demo.`)
  }

  // --- Categorías de demo ------------------------------------------------
  const categories = await productService.listProductCategories(
    { handle: DEMO_CATEGORY_HANDLES },
    { select: ['id', 'handle'] }
  )

  if (categories.length === 0) {
    logger.info('Categorías de demo: no hay nada que borrar.')
  } else {
    logger.info(
      `Categorías de demo a borrar: ${categories.map((c) => c.handle).join(', ')}`
    )
    await deleteProductCategoriesWorkflow(container).run({
      input: categories.map((c) => c.id),
    })
    logger.info(`Borradas ${categories.length} categorías de demo.`)
  }

  // --- Región de demo ----------------------------------------------------
  const regionService = container.resolve(Modules.REGION)
  const regions = await regionService.listRegions({ name: { $in: DEMO_REGIONS } })

  if (regions.length === 0) {
    logger.info('Regiones de demo: no hay nada que borrar.')
  } else {
    logger.info(`Regiones de demo a borrar: ${regions.map((r) => r.name).join(', ')}`)
    await deleteRegionsWorkflow(container).run({
      input: { ids: regions.map((r) => r.id) },
    })
    logger.info(`Borradas ${regions.length} regiones de demo.`)
  }

  // --- Opciones huérfanas -------------------------------------------------
  // `deleteProductsWorkflow` borra el producto y sus variantes, pero NO sus
  // opciones. Quedan vivas sin dueño y contaminan cualquier consulta sobre
  // opciones. Se detectan por diferencia, no por nombre, para que la limpieza
  // siga funcionando con datos que aún no conocemos.
  const productsWithOptions = await productService.listProducts(
    {},
    { relations: ['options'], select: ['id'] }
  )
  const usedOptionIds = new Set(
    productsWithOptions.flatMap((p: any) => (p.options ?? []).map((o: any) => o.id))
  )
  const allOptions = await productService.listProductOptions(
    {},
    { select: ['id', 'title'] }
  )
  const orphanOptions = allOptions.filter((o: any) => !usedOptionIds.has(o.id))

  if (orphanOptions.length === 0) {
    logger.info('Opciones huérfanas: no hay ninguna.')
  } else {
    logger.info(
      `Opciones huérfanas a borrar: ${orphanOptions.map((o: any) => o.title).join(', ')}`
    )
    await productService.deleteProductOptions(orphanOptions.map((o: any) => o.id))
    logger.info(`Borradas ${orphanOptions.length} opciones huérfanas.`)
  }

  // --- Estado final ------------------------------------------------------
  const [remainingProducts, remainingLocations, remainingCategories, remainingRegions] =
    await Promise.all([
      productService.listProducts({}),
      stockLocationService.listStockLocations({}),
      productService.listProductCategories({}),
      regionService.listRegions({}),
    ])

  logger.info(
    `Estado final -> productos: ${remainingProducts.length}, ` +
      `bodegas: ${remainingLocations.length}, ` +
      `categorías: ${remainingCategories.length}, ` +
      `regiones: ${remainingRegions.length}`
  )
}
