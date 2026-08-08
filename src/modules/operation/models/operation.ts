import { model } from '@medusajs/framework/utils'

/**
 * Operación-país. La unidad de separación del negocio: Colombia, Perú, México.
 *
 * NO es un tenant. Es una sola empresa con operaciones en varios países, así
 * que no hay aislamiento duro que defender: la gerencia necesita consolidar.
 * Lo que se busca es separación operativa, que se resuelve con permisos y
 * scope en la interfaz, no con infraestructura separada.
 *
 * Todo lo demás cuelga de aquí: bodegas, marcas representadas, pedidos y
 * disponibilidad. Los módulos de alto volumen guardan `operation_code` como
 * clave natural en vez de un Module Link, porque un link por cada fila de
 * hechos obliga a un join extra en toda consulta de BI sin aportar integridad
 * real: entre módulos de Medusa no existen foreign keys de todas formas
 * (CLAUDE.md §4.1). Las relaciones de baja cardinalidad sí van por Link.
 */
const Operation = model.define('operation', {
  id: model.id().primaryKey(),

  // Código ISO del país. Es la clave natural que viaja a los módulos de
  // hechos y a las vistas de BI.
  code: model.text().unique(),

  name: model.text(),

  // Moneda funcional de la operación, en minúsculas (cop, pen, mxn).
  currency_code: model.text(),

  is_active: model.boolean().default(true),
})

export default Operation
