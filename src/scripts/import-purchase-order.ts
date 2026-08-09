import fs from 'node:fs'
import path from 'node:path'

import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

import { PURCHASE_ORDER_MODULE } from '../modules/purchase-order'

/**
 * Importa un pedido desde el JSON producido por etl/extract_purchase_order.py.
 *
 * Es el backend del botón "cargar archivo" de la grilla: alguien monta el
 * pedido fuera, lo sube, y esto lo crea en estado DRAFT para revisarlo.
 *
 *   pnpm exec medusa exec ./src/scripts/import-purchase-order.ts
 */

export default async function importPurchaseOrder({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(PURCHASE_ORDER_MODULE)

  const dir = path.join(process.cwd(), 'data')
  const archivo = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('purchase-order-') && f.endsWith('.json'))
    .sort()
    .pop()

  if (!archivo) {
    throw new Error(
      'No hay ningún data/purchase-order-*.json. ' +
        'Genéralo antes: python etl/extract_purchase_order.py <archivo.xlsx>'
    )
  }

  const data = JSON.parse(fs.readFileSync(path.join(dir, archivo), 'utf8'))
  logger.info(
    `Origen: ${archivo} · ${data.meta.items} ítems · ${data.meta.packs} bultos · ` +
      `${data.meta.pares} pares`
  )

  // Correlativo por operación y marca
  const previos = await service.listPurchaseOrders(
    { operation_code: data.operation_code, brand_code: data.brand_code },
    { select: ['id'] }
  )
  const code = `PO-${data.operation_code}-${data.brand_code}-${String(
    previos.length + 1
  ).padStart(4, '0')}`

  const order = await service.createPurchaseOrders({
    code,
    operation_code: data.operation_code,
    brand_code: data.brand_code,
    currency_code: data.currency_code,
    status: 'DRAFT',
    placed_at: new Date(),
    notes: `Importado de ${data.meta.origen}`,
  })

  let pares = 0
  for (const it of data.items) {
    const item = await service.createPurchaseOrderItems({
      material_code: it.material_code,
      description: it.description,
      size_curve_code: it.size_curve_code,
      packs: it.packs,
      is_adjusted: it.is_adjusted,
      adjustment_note: it.adjustment_note,
      unit_cost_cents: it.unit_cost_cents,
      order_id: order.id,
    })

    await service.createPurchaseOrderSizes(
      it.sizes.map((s: any) => ({
        sku: s.sku,
        size_label: s.size_label,
        size_value: s.size_value,
        quantity_requested: s.quantity_requested,
        item_id: item.id,
      }))
    )
    pares += it.sizes.reduce((a: number, s: any) => a + s.quantity_requested, 0)
  }

  const ok = (a: number, b: number) => (a === b ? 'OK' : `ESPERADO ${b}  <-- REVISAR`)

  logger.info('')
  logger.info(`Pedido creado: ${code}  (estado DRAFT)`)
  logger.info(`  ítems : ${data.items.length}  ${ok(data.items.length, data.meta.items)}`)
  logger.info(`  pares : ${pares}  ${ok(pares, data.meta.pares)}`)
  logger.info(
    `  ajustados respecto a su curva: ${data.meta.items_ajustados} de ${data.meta.items}`
  )
}
