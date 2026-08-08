import { model } from '@medusajs/framework/utils'

/**
 * Marca comercial. Se enlaza a `product` mediante un Module Link en vez de
 * añadir una columna al modelo del core (CLAUDE.md §4.2).
 */
const Brand = model.define('brand', {
  id: model.id().primaryKey(),
  // Código corto y estable, usado en SKUs y reportes de BI.
  code: model.text().unique(),
  name: model.text(),
})

export default Brand
