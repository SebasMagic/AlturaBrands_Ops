import { MedusaError, Modules } from '@medusajs/framework/utils'
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'

import { GOODS_RECEIPT_MODULE } from '../../../modules/goods-receipt'
import { STOCK_LEDGER_MODULE } from '../../../modules/stock-ledger'
import { SUPPLY_AVAILABILITY_MODULE } from '../../../modules/supply-availability'

type Input = { receipt_id: string }

/**
 * Aplica una recepción: mueve mercancía de tránsito a bodega.
 *
 * Cuatro efectos, todos en el mismo paso para que compartan compensación:
 *   1. `stocked_quantity`  sube  → ya es nuestro y vendible
 *   2. `incoming_quantity` baja  → deja de estar en camino
 *   3. `supply_availability` IN_TRANSIT se reduce → el detalle sigue al saldo
 *   4. `stock_move` registra cada entrada → el kardex nace con la recepción
 *
 * Se usa `quantity_received`, nunca `quantity_expected`: lo que entra a
 * bodega es lo que se contó al abrir la caja, no lo que la marca dijo que
 * mandaba. Confundirlos infla el inventario con unidades que no llegaron.
 */
export const applyReceiptStockStep = createStep(
  'apply-goods-receipt-stock',
  async ({ receipt_id }: Input, { container }) => {
    const receiptService: any = container.resolve(GOODS_RECEIPT_MODULE)
    const supplyService: any = container.resolve(SUPPLY_AVAILABILITY_MODULE)
    const ledgerService: any = container.resolve(STOCK_LEDGER_MODULE)
    const inventoryService = container.resolve(Modules.INVENTORY)

    const receipt = await receiptService.retrieveGoodsReceipt(receipt_id, {
      relations: ['lines'],
    })

    if (receipt.status !== 'DRAFT') {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `La recepción ${receipt.code} está en ${receipt.status}. Solo se confirma una en DRAFT.`
      )
    }

    // Solo cuentan las líneas contadas con algo dentro. Una línea sin contar
    // (null) no es lo mismo que una contada en cero.
    const lineas = (receipt.lines ?? []).filter(
      (l: any) => l.quantity_received !== null && l.quantity_received > 0
    )
    if (lineas.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `La recepción ${receipt.code} no tiene ninguna línea contada con unidades.`
      )
    }

    const porSku = new Map<string, number>()
    lineas.forEach((l: any) =>
      porSku.set(l.sku, (porSku.get(l.sku) ?? 0) + Number(l.quantity_received))
    )

    // --- 1 y 2. Saldos de inventario ---------------------------------------
    const items = await inventoryService.listInventoryItems(
      { sku: [...porSku.keys()] },
      { select: ['id', 'sku'] }
    )
    const itemBySku = new Map<string, string>(
      items.map((i: any) => [i.sku as string, i.id as string])
    )

    const faltantes = [...porSku.keys()].filter((s) => !itemBySku.has(s))
    if (faltantes.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${faltantes.length} SKU de la recepción no existen en el catálogo: ` +
          faltantes.slice(0, 5).join(', ')
      )
    }

    const niveles = await inventoryService.listInventoryLevels(
      {
        location_id: receipt.warehouse_id,
        inventory_item_id: [...itemBySku.values()],
      },
      {
        select: [
          'inventory_item_id',
          'location_id',
          'stocked_quantity',
          'incoming_quantity',
        ],
      }
    )
    const nivelPorItem = new Map(niveles.map((n: any) => [n.inventory_item_id, n]))

    const nivelesAntes: {
      inventory_item_id: string
      location_id: string
      stocked: number
      incoming: number
      existia: boolean
    }[] = []
    const movimientos: any[] = []

    for (const [sku, cantidad] of porSku) {
      const itemId = itemBySku.get(sku)!
      const nivel: any = nivelPorItem.get(itemId)

      const stockedAntes = nivel ? Number(nivel.stocked_quantity ?? 0) : 0
      const incomingAntes = nivel ? Number(nivel.incoming_quantity ?? 0) : 0

      nivelesAntes.push({
        inventory_item_id: itemId,
        location_id: receipt.warehouse_id,
        stocked: stockedAntes,
        incoming: incomingAntes,
        existia: !!nivel,
      })

      // El tránsito no puede quedar negativo: si llega más de lo anunciado,
      // el excedente entra igual a bodega pero el camino se limpia a cero.
      const nuevoIncoming = Math.max(0, incomingAntes - cantidad)
      const nuevoStocked = stockedAntes + cantidad

      if (nivel) {
        await inventoryService.updateInventoryLevels([
          {
            inventory_item_id: itemId,
            location_id: receipt.warehouse_id,
            stocked_quantity: nuevoStocked,
            incoming_quantity: nuevoIncoming,
          },
        ])
      } else {
        await inventoryService.createInventoryLevels([
          {
            inventory_item_id: itemId,
            location_id: receipt.warehouse_id,
            stocked_quantity: nuevoStocked,
            incoming_quantity: 0,
          },
        ])
      }

      const linea = lineas.find((l: any) => l.sku === sku)
      movimientos.push({
        operation_code: receipt.operation_code,
        sku,
        warehouse_id: receipt.warehouse_id,
        kind: 'RECEIPT',
        quantity: cantidad,
        reference_type: 'goods_receipt',
        reference_id: receipt.code,
        balance_after: nuevoStocked,
        notes: linea?.discrepancy_note ?? null,
      })
    }

    // --- 3. El detalle de tránsito sigue al saldo ---------------------------
    const transito = await supplyService.listSupplyAvailabilities(
      { kind: 'IN_TRANSIT', sku: [...porSku.keys()] },
      { select: ['id', 'sku', 'quantity'] }
    )
    const transitoAntes = transito.map((t: any) => ({
      id: t.id,
      sku: t.sku,
      quantity: Number(t.quantity),
    }))

    const pendiente = new Map(porSku)
    const aBorrar: string[] = []
    const aActualizar: { id: string; quantity: number }[] = []

    for (const t of transitoAntes) {
      const resta = pendiente.get(t.sku) ?? 0
      if (resta <= 0) continue
      const consumido = Math.min(resta, t.quantity)
      pendiente.set(t.sku, resta - consumido)
      const restante = t.quantity - consumido
      if (restante <= 0) aBorrar.push(t.id)
      else aActualizar.push({ id: t.id, quantity: restante })
    }

    for (const u of aActualizar) {
      await supplyService.updateSupplyAvailabilities(u)
    }
    if (aBorrar.length) {
      await supplyService.deleteSupplyAvailabilities(aBorrar)
    }

    // --- 4. Kardex ---------------------------------------------------------
    const creados = await ledgerService.createStockMoves(movimientos)

    return new StepResponse(
      {
        skus: porSku.size,
        unidades: [...porSku.values()].reduce((a, b) => a + b, 0),
        movimientos: creados.length,
        transito_cerrado: aBorrar.length,
        transito_reducido: aActualizar.length,
      },
      {
        niveles: nivelesAntes,
        transito: transitoAntes,
        borrados: aBorrar,
        movimientos: creados.map((m: any) => m.id),
      }
    )
  },
  async (compensacion, { container }) => {
    if (!compensacion) return
    const supplyService: any = container.resolve(SUPPLY_AVAILABILITY_MODULE)
    const ledgerService: any = container.resolve(STOCK_LEDGER_MODULE)
    const inventoryService = container.resolve(Modules.INVENTORY)

    // Se restauran los valores EXACTOS previos, no se resta lo aplicado:
    // restar acumula error si algo cambió entre medias.
    for (const n of compensacion.niveles ?? []) {
      if (n.existia) {
        await inventoryService.updateInventoryLevels([
          {
            inventory_item_id: n.inventory_item_id,
            location_id: n.location_id,
            stocked_quantity: n.stocked,
            incoming_quantity: n.incoming,
          },
        ])
      }
    }

    // El tránsito borrado se recrea; el reducido vuelve a su cantidad.
    for (const t of compensacion.transito ?? []) {
      if (compensacion.borrados?.includes(t.id)) continue
      await supplyService.updateSupplyAvailabilities({
        id: t.id,
        quantity: t.quantity,
      })
    }

    if (compensacion.movimientos?.length) {
      await ledgerService.deleteStockMoves(compensacion.movimientos)
    }
  }
)
