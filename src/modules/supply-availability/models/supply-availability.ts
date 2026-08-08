import { model } from '@medusajs/framework/utils'

/**
 * Disponibilidad de mercancía que la empresa NO posee todavía.
 *
 * Deliberadamente separado del módulo `inventory`: estas unidades no pueden
 * reservarse ni despacharse. Si vivieran como `InventoryLevel`, un vendedor
 * podría comprometer 113.447 pares que están en la bodega del proveedor.
 *
 * Dos naturalezas distintas:
 *   SUPPLIER   - disponible en el proveedor (ATS USA). Requiere orden de
 *                compra antes de poder venderse.
 *   IN_TRANSIT - ya comprado, aún no recibido. Llega en `eta_days`.
 *
 * Se enlaza a `product_variant` con un Module Link (CLAUDE.md §4.2).
 */
const SupplyAvailability = model.define('supply_availability', {
  id: model.id().primaryKey(),

  // Clave de negocio del archivo maestro. Se conserva para poder rastrear
  // cada fila hasta su origen sin depender de los ids de Medusa.
  material_code: model.text(),

  // SKU de la variante correspondiente. Redundante con el link, pero permite
  // cargar y auditar antes de que el link exista.
  sku: model.text(),

  // Nombre tal cual viene en el archivo maestro: 'ATS USA',
  // 'Transito (60 dias)'. No se normaliza para no perder trazabilidad.
  source: model.text(),

  kind: model.enum(['SUPPLIER', 'IN_TRANSIT']),

  // Días estimados hasta la recepción. Nulo para SUPPLIER, que no tiene
  // fecha comprometida mientras no exista una orden de compra.
  eta_days: model.number().nullable(),

  quantity: model.number(),
})

export default SupplyAvailability
