'use server'

import { revalidatePath } from 'next/cache'
import { crearPedido } from '@/lib/db/pedidos'
import type { Curva, Linea, MaterialPedido } from '@/lib/domain/pedidos'
import { cantidades } from '@/lib/domain/pedidos'

export type LineaEnvio = { material: string; linea: Linea }

export type ResultadoCrearPedido =
  | { ok: true; code: string; items: number; pares: number }
  | { ok: false; error: string }

/**
 * Server Action: recibe las líneas tocadas por el comprador (estado que solo
 * existía en el navegador) y las convierte en un pedido real.
 *
 * La forma de las cantidades se recalcula AQUÍ, en el servidor, a partir de
 * `linea` y la curva — no se confía en un total que mandara el cliente. El
 * navegador decide qué teclear; el servidor decide qué es correcto.
 */
export async function crearPedidoAction(
  operacionCode: string,
  marcaCode: string,
  materiales: MaterialPedido[],
  curvas: Curva[],
  lineas: Record<string, Linea>
): Promise<ResultadoCrearPedido> {
  const curvasPorCodigo = new Map(curvas.map((c) => [c.code, c]))

  // `noUncheckedIndexedAccess` no conecta el filter con el map siguiente: la
  // guarda vive en el propio bucle para que `linea` quede acotada de verdad.
  const items: {
    materialCode: string
    description: string
    sizeCurveCode: string | null
    packs: number
    isAdjusted: boolean
    adjustmentNote: string | null
    unitCostCents: number | null
    sizes: { sku: string; quantityRequested: number }[]
  }[] = []

  for (const m of materiales) {
    const linea = lineas[m.material]
    if (!linea) continue

    const qty = cantidades(linea, curvasPorCodigo.get(linea.curva))
    const sizes = Object.entries(qty)
      .filter(([, q]) => q > 0)
      .map(([talla, q]) => ({
        sku: m.tallas[talla]?.sku ?? `${m.material}-${m.escala}${talla}`,
        quantityRequested: q,
      }))

    if (sizes.length === 0) continue

    items.push({
      materialCode: m.material,
      description: m.descripcion,
      sizeCurveCode: linea.curva || null,
      packs: linea.packs,
      isAdjusted: !!linea.override,
      adjustmentNote: linea.override
        ? `Ajustadas a mano: ${Object.keys(linea.override).join(', ')}`
        : null,
      unitCostCents: m.costoUsdCents,
      sizes,
    })
  }

  if (items.length === 0) {
    return { ok: false, error: 'El pedido no tiene líneas con cantidades.' }
  }

  try {
    const creado = await crearPedido({
      operationCode: operacionCode,
      brandCode: marcaCode,
      currencyCode: 'usd',
      notes: 'Creado desde la grilla del sitio propio',
      items,
    })
    revalidatePath('/pedidos')
    return { ok: true, code: creado.code, items: items.length, pares: creado.pares }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo crear el pedido' }
  }
}
