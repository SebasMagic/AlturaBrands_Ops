import { ExecArgs } from '@medusajs/framework/types'
import { Modules } from '@medusajs/framework/utils'
import {
  deleteProductsWorkflow,
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

  // --- Estado final ------------------------------------------------------
  const [remainingProducts, remainingLocations] = await Promise.all([
    productService.listProducts({}),
    stockLocationService.listStockLocations({}),
  ])

  logger.info(
    `Estado final -> productos: ${remainingProducts.length}, ` +
      `bodegas: ${remainingLocations.length}`
  )
}
