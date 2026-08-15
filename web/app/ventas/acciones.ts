'use server'

import { revalidatePath } from 'next/cache'
import { crearCliente, type NuevoCliente } from '@/lib/db/clientes'
import { reservarPedido } from '@/lib/db/reservas'
import {
  cancelarVenta,
  confirmarVenta,
  crearCotizacion,
  crearDespacho,
  moverDespacho,
  type NuevaVenta,
  type Resultado,
} from '@/lib/db/ventas'
import type { EstadoDespacho } from '@/lib/domain/ventas'

const OPERACION = 'CO'

/** Todas las pantallas que cambian cuando se mueve un pedido. */
function refrescar(orderId?: number) {
  revalidatePath('/ventas')
  // Las dos pantallas de embudo: la comercial muestra el valor de la
  // oportunidad, la de operaciones el avance del despacho.
  revalidatePath('/embudo')
  revalidatePath('/operaciones')
  revalidatePath('/inventario')
  if (orderId) revalidatePath(`/ventas/${orderId}`)
}

export async function crearClienteAction(datos: NuevoCliente) {
  const r = await crearCliente(OPERACION, datos)
  if (r.ok) revalidatePath('/clientes')
  return r
}

export async function crearCotizacionAction(datos: Omit<NuevaVenta, 'operacion'>) {
  const r = await crearCotizacion({ ...datos, operacion: OPERACION })
  if (r.ok) refrescar()
  return r
}

export async function confirmarVentaAction(orderId: number): Promise<Resultado> {
  const r = await confirmarVenta(orderId)
  if (r.ok) refrescar(orderId)
  return r
}

/**
 * Reservar es la acción con más consecuencias de esta pantalla: compromete
 * inventario que deja de estar disponible para todos los demás.
 */
export async function reservarAction(orderId: number): Promise<Resultado> {
  const r = await reservarPedido(orderId)
  if (r.ok) {
    refrescar(orderId)
    return { ok: true, detalle: `${r.reservados} par(es) reservados.` }
  }
  const detalle = r.faltantes.length
    ? ` Faltan: ${r.faltantes.map((f) => `${f.sku} (pide ${f.pedido}, hay ${f.disponible})`).join('; ')}`
    : ''
  return { ok: false, error: r.error + detalle }
}

export async function cancelarVentaAction(orderId: number): Promise<Resultado> {
  const r = await cancelarVenta(orderId)
  if (r.ok) refrescar(orderId)
  return r
}

export async function crearDespachoAction(orderId: number): Promise<Resultado> {
  const r = await crearDespacho(orderId)
  if (r.ok) refrescar(orderId)
  return r
}

export async function moverDespachoAction(
  shipmentId: number,
  a: EstadoDespacho,
  orderId: number
): Promise<Resultado> {
  const r = await moverDespacho(shipmentId, a)
  if (r.ok) refrescar(orderId)
  return r
}
