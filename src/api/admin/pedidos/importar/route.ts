import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'

import { leerHojaDePedido } from '../../../../lib/order-sheet'
import { SIZE_CURVE_MODULE } from '../../../../modules/size-curve'
import { createPurchaseOrderWorkflow } from '../../../../workflows/purchase-order'

/**
 * POST /admin/pedidos/importar
 *
 * Recibe un Excel con el layout de pedido de la marca y lo convierte en un
 * pedido en estado Montado.
 *
 * Con `?dry_run=1` solo devuelve la lectura y los avisos, sin crear nada: así
 * el usuario ve qué entendió el sistema antes de comprometerse.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const archivo = (req as any).file as
    | { originalname: string; buffer: Buffer; size: number }
    | undefined

  if (!archivo) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'No se recibió ningún archivo. Envíalo como campo "file".'
    )
  }
  if (!/\.xlsx?$/i.test(archivo.originalname)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `"${archivo.originalname}" no es un Excel. Se esperaba .xlsx o .xls.`
    )
  }

  const curveService: any = req.scope.resolve(SIZE_CURVE_MODULE)
  const curvas = await curveService.listSizeCurves(
    { is_active: true },
    { relations: ['entries'] }
  )

  const lectura = await leerHojaDePedido(
    archivo.buffer,
    curvas.map((c: any) => ({
      code: c.code,
      scale: c.scale,
      entries: (c.entries ?? []).map((e: any) => ({
        size_label: e.size_label,
        ratio: Number(e.ratio),
      })),
    }))
  )

  if (lectura.errores.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `El archivo no tiene el formato esperado: ${lectura.errores.join(' ')}`
    )
  }
  if (lectura.items.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'No se encontró ninguna línea con bultos y tallas.'
    )
  }

  const { operacion = 'CO', marca = 'KEEN', dry_run } = req.query as Record<
    string,
    string | undefined
  >

  // Vista previa: deja ver qué entendió el sistema antes de crear nada.
  if (dry_run) {
    res.json({
      preview: true,
      archivo: archivo.originalname,
      ...lectura,
      items: lectura.items.slice(0, 10),
    })
    return
  }

  const { result } = await createPurchaseOrderWorkflow(req.scope).run({
    input: {
      operation_code: operacion,
      brand_code: marca,
      currency_code: 'usd',
      notes: `Importado de ${archivo.originalname}`,
      items: lectura.items,
    },
  })

  res.status(201).json({
    ...result,
    avisos: lectura.avisos,
    resumen: lectura.resumen,
  })
}
