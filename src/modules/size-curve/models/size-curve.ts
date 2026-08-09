import { model } from '@medusajs/framework/utils'

/**
 * Curva de tallas: cómo se reparte un bulto entre las tallas de una corrida.
 *
 * En calzado mayorista no se piden pares sueltos sino bultos, y cada bulto
 * trae una distribución fija: más pares de las tallas centrales, menos de los
 * extremos. `Bultos x curva = cantidades`, que es exactamente lo que hace el
 * formato de pedido de KEEN.
 *
 * La curva NO es del producto ni una constante del negocio: es una regla que
 * el equipo define y ajusta según lo que sabe del mercado. Por eso es entidad
 * propia y editable, y no un atributo fijo en el producto.
 *
 * Los dos modelos viven en el mismo archivo porque se referencian mutuamente.
 */

export const SizeCurve = model.define('size_curve', {
  id: model.id().primaryKey(),

  // Código estable para referirse a ella desde pedidos y reportes.
  code: model.text().unique(),

  name: model.text(),

  // Escala de tallas a la que aplica: M, W, C, Y, T. Una curva de MEN no
  // puede aplicarse a CHILDREN aunque compartan números de talla.
  scale: model.text(),

  // Suma de las proporciones. Derivado, se guarda para no recalcularlo en
  // cada consulta: en KEEN se observaron bultos de 8 a 12 pares.
  pairs_per_pack: model.number(),

  // Curva sugerida por defecto para su escala. La grilla la precarga, y el
  // comprador puede cambiarla o editar celdas.
  is_default: model.boolean().default(false),

  is_active: model.boolean().default(true),

  entries: model.hasMany(() => SizeCurveEntry, { mappedBy: 'curve' }),
})

export const SizeCurveEntry = model.define('size_curve_entry', {
  id: model.id().primaryKey(),

  // Etiqueta tal como se muestra: '8.5'. Se guarda junto al valor numérico
  // porque una es para mostrar y la otra para ordenar y comparar.
  size_label: model.text(),

  // float, NO number: `model.number()` se mapea a integer y redondea las
  // medias tallas — 7.5 se guardaba como 8 y colisionaba con la talla 8,
  // rompiendo cualquier orden o comparación numérica.
  size_value: model.float(),

  // Pares de esta talla por cada bulto.
  ratio: model.number(),

  curve: model.belongsTo(() => SizeCurve, { mappedBy: 'entries' }),
})

export default SizeCurve
