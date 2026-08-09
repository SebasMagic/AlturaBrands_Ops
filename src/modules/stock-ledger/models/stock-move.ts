import { model } from '@medusajs/framework/utils'

/**
 * Kardex: el registro inmutable de TODA variación de existencias.
 *
 * Medusa guarda el saldo (`inventory_level`) pero no cómo se llegó a él. Sin
 * este historial no se puede responder "¿por qué esta talla tiene 3 y no 5?",
 * que en un ERP es la pregunta que separa un inventario auditable de una cifra
 * en la que hay que creer.
 *
 * Regla: el saldo de una variante en una bodega debe poder reconstruirse
 * sumando sus movimientos. Si no cuadra, hay un camino que se saltó las reglas
 * — y eso es un bug, no una discrepancia aceptable.
 *
 * Nada se edita ni se borra aquí. Un error se corrige con un movimiento
 * contrario, igual que en contabilidad.
 */
const StockMove = model.define('stock_move', {
  id: model.id().primaryKey(),

  operation_code: model.text(),

  // Clave natural, no link: es una tabla de hechos que va a crecer sin
  // límite y un join por fila encarecería toda consulta de BI.
  sku: model.text(),
  warehouse_id: model.text(),

  /**
   * Qué causó el movimiento. El signo va en `quantity`, no en el tipo:
   * así una suma sobre el kardex da el saldo sin ningún CASE.
   */
  kind: model.enum([
    'RECEIPT', // recepción de mercancía comprada
    'SALE', // salida por venta
    'ADJUSTMENT', // ajuste por conteo físico
    'TRANSFER_IN', // entrada por transferencia entre bodegas
    'TRANSFER_OUT', // salida por transferencia
    'RETURN', // devolución de cliente
  ]),

  // Positiva entra, negativa sale. Sin excepciones.
  quantity: model.number(),

  // Documento que lo originó: código de recepción, de pedido, de ajuste.
  // Permite reconstruir el porqué sin salir de esta tabla.
  reference_type: model.text(),
  reference_id: model.text(),

  // Saldo resultante tras aplicar el movimiento. Redundante a propósito:
  // permite detectar en una sola consulta si el kardex y el saldo real
  // divergieron, sin recalcular toda la historia.
  balance_after: model.number().nullable(),

  notes: model.text().nullable(),
})

export default StockMove
