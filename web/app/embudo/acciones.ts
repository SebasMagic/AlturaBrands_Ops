'use server'

import { revalidatePath } from 'next/cache'
import { moverOportunidad, type ResultadoMover } from '@/lib/db/comercial'
import type { EtapaComercial } from '@/lib/domain/comercial'

/**
 * Mover una tarjeta no es sólo cosmético: al soltar en Ganado el pedido pasa
 * a firme, y al soltar en Perdido se libera el inventario reservado. Por eso
 * se revalidan también Ventas, Operaciones e Inventario.
 */
export async function moverOportunidadAction(
  orderId: number,
  aEtapa: EtapaComercial,
  nuevoOrden: number
): Promise<ResultadoMover> {
  const r = await moverOportunidad(orderId, aEtapa, nuevoOrden)
  if (r.ok) {
    revalidatePath('/embudo')
    revalidatePath('/ventas')
    revalidatePath('/operaciones')
    revalidatePath('/inventario')
  }
  return r
}
