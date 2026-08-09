import { model } from '@medusajs/framework/utils'

/**
 * Pedido a una marca.
 *
 * Tres niveles y no dos: cabecera, ítem por material y detalle por talla. El
 * tercero existe porque hay que comparar *lo pedido* contra *lo confirmado*
 * talla a talla — la marca ajusta cantidades según su disponibilidad real. Un
 * desglose metido en un JSON sería inconsultable desde BI.
 *
 * Ciclo de vida:
 *   DRAFT           Montado. Se edita libremente.
 *   QTY_CHECKED     La marca revisó disponibilidad y ajustó cantidades.
 *   CLIENT_APPROVED Aprobado. Ya no se toca.
 *   DISPATCHED      Despachado, con ticket y fecha. Alimenta tránsito.
 *
 * Las fechas de cada transición se guardan por separado: la diferencia entre
 * ellas es el lead time real por tramo y por marca, que es justo lo que se
 * quiere medir.
 */

export const PurchaseOrder = model.define('purchase_order', {
  id: model.id().primaryKey(),

  // Legible por humanos: PO-CO-KEEN-0001. Es lo que se cita en correos.
  code: model.text().unique(),

  // Claves naturales, no Module Links: los pedidos son tabla de hechos y el
  // grano de BI es (operación, marca). Ver el módulo `operation`.
  operation_code: model.text(),
  brand_code: model.text(),

  status: model
    .enum(['DRAFT', 'QTY_CHECKED', 'CLIENT_APPROVED', 'DISPATCHED', 'CANCELLED'])
    .default('DRAFT'),

  // Moneda en la que se compra a la marca. No es la de la operación: se compra
  // en USD y se vende en pesos.
  currency_code: model.text(),

  notes: model.text().nullable(),

  // Una marca de tiempo por transición. Guardar solo `updated_at` haría
  // imposible reconstruir cuánto tardó cada tramo.
  placed_at: model.dateTime().nullable(),
  qty_checked_at: model.dateTime().nullable(),
  approved_at: model.dateTime().nullable(),
  dispatched_at: model.dateTime().nullable(),

  // Comprobante de despacho de la marca. Su fecha contra `placed_at` da el
  // lead time que permite prometer entregas con fundamento.
  dispatch_ticket: model.text().nullable(),

  items: model.hasMany(() => PurchaseOrderItem, { mappedBy: 'order' }),
})

export const PurchaseOrderItem = model.define('purchase_order_item', {
  id: model.id().primaryKey(),

  material_code: model.text(),
  description: model.text(),

  // Curva aplicada y bultos pedidos: juntos reproducen las cantidades.
  size_curve_code: model.text().nullable(),
  packs: model.number().default(0),

  /**
   * Si el comprador tocó celdas después de aplicar la curva.
   *
   * Se guarda la curva MÁS el ajuste, en vez de una curva inventada: así queda
   * registrado "usó KEEN-M-01 y quitó la 10.5", que responde preguntas de
   * negocio. Guardar solo el resultado final pierde el porqué, que es
   * exactamente lo que pasó en el Excel de origen.
   */
  is_adjusted: model.boolean().default(false),
  adjustment_note: model.text().nullable(),

  // Precio de compra unitario, en centavos enteros (CLAUDE.md §6). La regla de
  // la unidad mayor solo aplica a los precios nativos de Medusa.
  unit_cost_cents: model.number().nullable(),

  order: model.belongsTo(() => PurchaseOrder, { mappedBy: 'items' }),
  sizes: model.hasMany(() => PurchaseOrderSize, { mappedBy: 'item' }),
})

export const PurchaseOrderSize = model.define('purchase_order_size', {
  id: model.id().primaryKey(),

  // SKU de la variante. Clave natural, para poder auditar la línea sin
  // depender de los ids internos de Medusa.
  sku: model.text(),

  size_label: model.text(),

  // float, NO number: `model.number()` es integer y redondearía las medias
  // tallas, colisionando 7.5 con 8.
  size_value: model.float(),

  quantity_requested: model.number().default(0),

  // Nulo hasta que la marca revise. Distinto de cero, que significa "revisado
  // y no hay". Esa diferencia importa al reclamar.
  quantity_confirmed: model.number().nullable(),

  item: model.belongsTo(() => PurchaseOrderItem, { mappedBy: 'sizes' }),
})

export default PurchaseOrder
