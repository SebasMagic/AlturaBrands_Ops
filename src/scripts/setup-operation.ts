import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

import { BRAND_MODULE } from '../modules/brand'
import { OPERATION_MODULE } from '../modules/operation'

/**
 * Da de alta la operación Colombia y le cuelga lo que ya existe.
 *
 * Idempotente. Es el script que se repite por cada país nuevo: cambiar la
 * constante y las marcas que representa.
 *
 *   pnpm exec medusa exec ./src/scripts/setup-operation.ts
 */

const OPERATION = { code: 'CO', name: 'Colombia', currency_code: 'cop' }
const BRANDS_DE_LA_OPERACION = ['KEEN']
const BODEGAS_DE_LA_OPERACION = ['Bodega Matriz']

export default async function setupOperation({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const operationService: any = container.resolve(OPERATION_MODULE)
  const brandService: any = container.resolve(BRAND_MODULE)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)

  // --- Operación ---------------------------------------------------------
  let [operation] = await operationService.listOperations({ code: OPERATION.code })
  if (!operation) {
    operation = await operationService.createOperations(OPERATION)
    logger.info(`Operación creada: ${operation.code} — ${operation.name}`)
  } else {
    logger.info(`Operación ya existente: ${operation.code}`)
  }

  // --- Reglas de pedido de la marca --------------------------------------
  // KEEN pide en bultos: un paquete cerrado con curva de tallas. El tamaño por
  // defecto es solo referencia; la cifra real la fija la curva, que varía por
  // modelo (se observaron curvas de 8 a 12 pares en el formato de pedido).
  const brands = await brandService.listBrands({ code: BRANDS_DE_LA_OPERACION })
  for (const b of brands) {
    if (b.code === 'KEEN' && b.order_unit !== 'PACK') {
      await brandService.updateBrands({
        id: b.id,
        order_unit: 'PACK',
        default_pack_size: 12,
      })
      logger.info(`Marca ${b.code}: unidad de pedido -> PACK (12 pares de referencia)`)
    }
  }

  // --- Enlaces -----------------------------------------------------------
  const enlaces: Record<string, any>[] = []

  for (const b of brands) {
    enlaces.push({
      [OPERATION_MODULE]: { operation_id: operation.id },
      [BRAND_MODULE]: { brand_id: b.id },
    })
  }

  const bodegas = await stockLocationService.listStockLocations({
    name: BODEGAS_DE_LA_OPERACION,
  })
  for (const w of bodegas) {
    enlaces.push({
      [OPERATION_MODULE]: { operation_id: operation.id },
      [Modules.STOCK_LOCATION]: { stock_location_id: w.id },
    })
  }

  if (enlaces.length) {
    // `create` es idempotente sobre los pares ya enlazados.
    await link.create(enlaces)
    logger.info(
      `Enlazados a ${operation.code}: ${brands.length} marca(s), ${bodegas.length} bodega(s)`
    )
  }

  // --- Resumen -----------------------------------------------------------
  const todas = await operationService.listOperations({})
  logger.info('')
  logger.info('--- Operaciones registradas ---')
  todas.forEach((o: any) =>
    logger.info(`  ${o.code}  ${o.name}  (${o.currency_code})  activa=${o.is_active}`)
  )
}
