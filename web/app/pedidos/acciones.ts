'use server'

import { revalidatePath } from 'next/cache'
import { cambiarEstadoPedido, type ResultadoTransicion } from '@/lib/db/purchase-order'
import type { EstadoPedido } from '@/lib/domain/purchase-order'

/**
 * Server Action de transición de estado.
 *
 * La validación de si la transición es legal ocurre en el servidor, dentro de
 * la transacción y con la fila bloqueada — nunca se confía en que el botón
 * mostrado por el navegador fuera el correcto.
 */
export async function cambiarEstadoAction(
  orderId: number,
  a: EstadoPedido,
  opciones: { dispatchTicket?: string; etaDays?: number } = {}
): Promise<ResultadoTransicion> {
  const resultado = await cambiarEstadoPedido(orderId, a, opciones)
  if (resultado.ok) {
    revalidatePath('/pedidos')
    revalidatePath('/inventario')
  }
  return resultado
}
