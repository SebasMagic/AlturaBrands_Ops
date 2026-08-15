'use client'

import { useState, useTransition } from 'react'
import {
  cancelarVentaAction,
  confirmarVentaAction,
  crearDespachoAction,
  moverDespachoAction,
  reservarAction,
} from '@/app/ventas/acciones'
import type { VentaDetalle } from '@/lib/db/ventas'
import { ETIQUETA_DESPACHO, transicionesDespacho } from '@/lib/domain/ventas'

const boton =
  'rounded-md border border-line px-3 py-1.5 text-sm text-ink-subtle hover:bg-surface-hover hover:text-ink disabled:opacity-50'
const primario =
  'rounded-md bg-interactive px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50'

export function AccionesVenta({ venta }: { venta: VentaDetalle }) {
  const [pendiente, startTransition] = useTransition()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; mensaje: string } | null>(null)

  const correr = (fn: () => Promise<{ ok: true; detalle: string } | { ok: false; error: string }>) => {
    setAviso(null)
    startTransition(async () => {
      const r = await fn()
      setAviso(r.ok ? { tipo: 'ok', mensaje: r.detalle } : { tipo: 'error', mensaje: r.error })
    })
  }

  const sinReservar = venta.lineas.some((l) => l.reservada + l.despachada < l.cantidad)
  const hayReservado = venta.lineas.some((l) => l.reservada > 0)

  return (
    <div className="flex flex-col gap-y-3">
      <div className="border-line bg-surface flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3">
        {venta.status === 'COTIZACION' && (
          <button className={primario} disabled={pendiente} onClick={() => correr(() => confirmarVentaAction(venta.id))}>
            Confirmar pedido
          </button>
        )}

        {venta.status === 'CONFIRMADO' && sinReservar && (
          <button className={primario} disabled={pendiente} onClick={() => correr(() => reservarAction(venta.id))}>
            Reservar inventario
          </button>
        )}

        {venta.status === 'CONFIRMADO' && hayReservado && (
          <button className={boton} disabled={pendiente} onClick={() => correr(() => crearDespachoAction(venta.id))}>
            Crear despacho
          </button>
        )}

        {venta.status !== 'CANCELADO' && (
          <button
            className={`${boton} border-danger/30 text-danger hover:bg-danger-bg`}
            disabled={pendiente}
            onClick={() => {
              if (window.confirm(`¿Cancelar ${venta.code}? Se liberará lo reservado.`)) {
                correr(() => cancelarVentaAction(venta.id))
              }
            }}
          >
            Cancelar pedido
          </button>
        )}

        <span className="text-ink-muted ml-auto text-xs">
          {venta.status === 'COTIZACION'
            ? 'Una cotización no compromete inventario.'
            : venta.status === 'CONFIRMADO' && sinReservar
              ? 'Reservar comprometerá el stock: dejará de estar disponible para otros.'
              : ''}
        </span>
      </div>

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

      {venta.despachos.length > 0 && (
        <div className="border-line bg-surface overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-ink-subtle text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Despacho</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 text-right font-medium tabular-nums">Pares</th>
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {venta.despachos.map((d) => (
                <tr key={d.id}>
                  <td className="text-ink px-3 py-2 font-medium tabular-nums">{d.code}</td>
                  <td className="text-ink-subtle px-3 py-2 text-xs">{ETIQUETA_DESPACHO[d.status]}</td>
                  <td className="text-ink px-3 py-2 text-right tabular-nums">{d.unidades}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {transicionesDespacho(d.status).length === 0 && (
                        <span className="text-ink-muted text-xs">—</span>
                      )}
                      {transicionesDespacho(d.status).map((a) => (
                        <button
                          key={a}
                          disabled={pendiente}
                          onClick={() => {
                            // Despachar descuenta inventario de verdad y es
                            // irreversible: se confirma antes.
                            if (
                              a === 'DESPACHADO' &&
                              !window.confirm(
                                `Al despachar ${d.code} el inventario se descuenta y queda el asiento en el kardex. No se puede deshacer. ¿Continuar?`
                              )
                            ) {
                              return
                            }
                            correr(() => moverDespachoAction(d.id, a, venta.id))
                          }}
                          className={`rounded border px-2 py-1 text-xs ${
                            a === 'CANCELADO'
                              ? 'border-danger/30 text-danger hover:bg-danger-bg'
                              : 'border-line text-ink-subtle hover:bg-surface-hover hover:text-ink'
                          } disabled:opacity-50`}
                        >
                          {ETIQUETA_DESPACHO[a]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
