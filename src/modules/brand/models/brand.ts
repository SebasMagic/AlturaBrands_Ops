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

  /**
   * Unidad en la que la marca acepta pedidos.
   *
   * Cada marca impone sus reglas: KEEN exige bultos (un paquete cerrado con
   * una curva de tallas predefinida), otras aceptan pares sueltos. Esta regla
   * es de la MARCA, no del producto ni del negocio — modelarla como constante
   * global obligaría a rehacerlo con la segunda marca.
   */
  order_unit: model.enum(['PACK', 'PAIR']).default('PAIR'),

  /**
   * Si la marca pide en bultos, cuántos pares trae uno por defecto. Es solo
   * una referencia: la cifra real la determina la curva aplicada, que varía
   * por modelo (en KEEN se observaron curvas de 8 a 12 pares).
   */
  default_pack_size: model.number().nullable(),
})

export default Brand
