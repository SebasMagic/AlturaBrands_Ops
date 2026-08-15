'use client'

import { useState, useTransition } from 'react'
import { cambiarEstadoAction } from '@/app/pedidos/acciones'
import type { PedidoResumen } from '@/lib/db/purchase-order'
import { ETIQUETA, transicionesPermitidas, type EstadoPedido } from '@/lib/domain/purchase-order'

const num = 'tabular-nums'

/** Color por estado: gris lo que aún no avanza, verde lo que ya despachó. */
const TONO: Record<EstadoPedido, string> = {
  DRAFT: 'border-line bg-surface-subtle text-ink-subtle',
  QTY_CHECKED: 'border-stock-transito/30 bg-stock-transito/10 text-stock-transito',
  CLIENT_APPROVED: 'border-interactive/30 bg-interactive/10 text-interactive',
  DISPATCHED: 'border-stock-bodega/30 bg-stock-bodega/10 text-stock-bodega',
  CANCELLED: 'border-danger/30 bg-danger-bg text-danger',
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

export function Bandeja({ pedidos }: { pedidos: PedidoResumen[] }) {
  const [pendiente, startTransition] = useTransition()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; mensaje: string } | null>(null)
  const [enCurso, setEnCurso] = useState<number | null>(null)

  const ejecutar = (pedido: PedidoResumen, a: EstadoPedido) => {
    // El despacho es la única transición con efectos fuera del pedido: pide
    // ticket y ETA porque son los datos que hacen creíble una promesa de entrega.
    const opciones: { dispatchTicket?: string; etaDays?: number } = {}
    if (a === 'DISPATCHED') {
      const ticket = window.prompt(`Ticket de despacho de la marca para ${pedido.code}:`, '')
      if (ticket === null) return
      const eta = window.prompt('Días estimados hasta la recepción (ETA):', '30')
      if (eta === null) return
      const limpio = ticket.trim()
      if (limpio) opciones.dispatchTicket = limpio
      opciones.etaDays = parseInt(eta, 10) || 30
    }
    if (a === 'CANCELLED' && !window.confirm(`¿Cancelar ${pedido.code}? No se puede deshacer.`)) return

    setEnCurso(pedido.id)
    setAviso(null)
    startTransition(async () => {
      const r = await cambiarEstadoAction(pedido.id, a, opciones)
      setEnCurso(null)
      setAviso(
        r.ok
          ? { tipo: 'ok', mensaje: `${r.code} → ${ETIQUETA[a]}. ${r.detalle}`.trim() }
          : { tipo: 'error', mensaje: r.error }
      )
    })
  }

  if (pedidos.length === 0) {
    return (
      <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
        <p className="text-ink-subtle text-sm">Todavía no hay pedidos a la marca.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      {aviso && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            aviso.tipo === 'ok'
              ? 'border-stock-bodega/30 bg-stock-bodega/10 text-stock-bodega'
              : 'border-danger/30 bg-danger-bg text-danger'
          }`}
        >
          {aviso.mensaje}
        </div>
      )}

      <div className="border-line bg-surface overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-subtle text-ink-subtle text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Pedido</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className={`px-3 py-2 text-right font-medium ${num}`}>Materiales</th>
              <th className={`px-3 py-2 text-right font-medium ${num}`}>Pedidos</th>
              <th className={`px-3 py-2 text-right font-medium ${num}`}>Confirmados</th>
              <th className={`px-3 py-2 text-right font-medium ${num}`}>Costo USD</th>
              <th className="px-3 py-2 font-medium">Colocado</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {pedidos.map((p) => {
              const acciones = transicionesPermitidas(p.status)
              const ocupado = pendiente && enCurso === p.id
              return (
                <tr key={p.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <div className={`text-ink font-medium ${num}`}>{p.code}</div>
                    <div className="text-ink-muted text-xs">
                      {p.marca}
                      {p.dispatchTicket ? ` · ticket ${p.dispatchTicket}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${TONO[p.status]}`}>
                      {ETIQUETA[p.status]}
                    </span>
                  </td>
                  <td className={`text-ink-subtle px-3 py-2 text-right ${num}`}>{p.items}</td>
                  <td className={`text-ink px-3 py-2 text-right ${num}`}>{p.paresPedidos}</td>
                  <td className={`px-3 py-2 text-right ${num} ${p.paresConfirmados === null ? 'text-ink-muted' : 'text-ink'}`}>
                    {/* Nulo es "la marca no ha revisado"; cero sería "revisó y no hay". */}
                    {p.paresConfirmados === null ? 'sin revisar' : p.paresConfirmados}
                  </td>
                  <td className={`text-ink-subtle px-3 py-2 text-right ${num}`}>
                    {(p.costoUsdCents / 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })}
                  </td>
                  <td className={`text-ink-subtle px-3 py-2 text-xs ${num}`}>{fecha(p.placedAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {acciones.length === 0 && <span className="text-ink-muted text-xs">—</span>}
                      {acciones.map((a) => (
                        <button
                          key={a}
                          disabled={ocupado}
                          onClick={() => ejecutar(p, a)}
                          className={`rounded border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                            a === 'CANCELLED'
                              ? 'border-danger/30 text-danger hover:bg-danger-bg'
                              : 'border-line text-ink-subtle hover:bg-surface-hover hover:text-ink'
                          }`}
                        >
                          {ocupado ? '…' : ETIQUETA[a]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
