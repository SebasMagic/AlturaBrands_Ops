import { model } from '@medusajs/framework/utils'

/**
 * Recepción de mercancía: el paso que convierte tránsito en existencias.
 *
 * Es la pieza que faltaba para cerrar el ciclo. Sin ella se puede comprar y se
 * puede vender, pero lo comprado nunca llega a ser vendible.
 *
 * Se recibe CONTRA una orden de compra despachada. Recepciones parciales son
 * la norma, no la excepción: un contenedor rara vez llega completo, y forzar
 * un todo-o-nada obligaría a mentir en el conteo para poder cerrarlo.
 */
export const GoodsReceipt = model.define('goods_receipt', {
  id: model.id().primaryKey(),

  code: model.text().unique(),
  operation_code: model.text(),

  // Clave natural hacia la orden: permite auditar la recepción aunque la
  // orden se archive, y no obliga a un Module Link por cada documento.
  purchase_order_code: model.text(),
  warehouse_id: model.text(),

  /**
   * DRAFT     se está contando; no ha tocado el inventario todavía
   * CONFIRMED aplicada; el stock ya se movió y el kardex está escrito
   * CANCELLED anulada antes de confirmar
   *
   * Una recepción confirmada NO se edita. Un error se corrige con un ajuste
   * de inventario, que deja su propio rastro en el kardex.
   */
  status: model.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']).default('DRAFT'),

  // Referencia física: número de contenedor, guía o remisión de la marca.
  // Es lo que permite atar la recepción al papel cuando algo no cuadra.
  reference: model.text().nullable(),

  received_at: model.dateTime().nullable(),
  confirmed_at: model.dateTime().nullable(),
  received_by: model.text().nullable(),

  notes: model.text().nullable(),

  lines: model.hasMany(() => GoodsReceiptLine, { mappedBy: 'receipt' }),
})

export const GoodsReceiptLine = model.define('goods_receipt_line', {
  id: model.id().primaryKey(),

  sku: model.text(),
  material_code: model.text(),
  size_label: model.text(),

  // Lo que la marca dijo que despachaba, traído de la orden de compra.
  quantity_expected: model.number(),

  /**
   * Lo que de verdad se contó al abrir la caja.
   *
   * Nullable a propósito: nulo es "esta talla aún no se ha contado", cero es
   * "se contó y no vino nada". La diferencia importa al reclamar — no es lo
   * mismo un faltante confirmado que un conteo pendiente.
   */
  quantity_received: model.number().nullable(),

  // Motivo cuando recibido != esperado. Es lo que sustenta la reclamación.
  discrepancy_note: model.text().nullable(),

  receipt: model.belongsTo(() => GoodsReceipt, { mappedBy: 'lines' }),
})

export default GoodsReceipt
