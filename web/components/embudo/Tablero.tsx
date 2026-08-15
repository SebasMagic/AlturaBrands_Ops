'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { moverOportunidadAction } from '@/app/embudo/acciones'
import {
  ETAPAS,
  TONO,
  agruparPorEtapa,
  calcularResumen,
  type EtapaComercial,
  type Oportunidad,
} from '@/lib/domain/comercial'

const num = 'tabular-nums'
const pesos = (cents: number) =>
  (cents / 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })

type Vista = 'kanban' | 'lista'

/** Huecos de 100 para poder insertar en medio sin reescribir toda la columna. */
const PASO = 100

export function Tablero({ inicial }: { inicial: Oportunidad[] }) {
  const [oportunidades, setOportunidades] = useState(inicial)
  const [vista, setVista] = useState<Vista>('kanban')
  const [arrastrando, setArrastrando] = useState<number | null>(null)
  const [sobre, setSobre] = useState<EtapaComercial | null>(null)
  const [, startTransition] = useTransition()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; mensaje: string } | null>(null)

  const porEtapa = useMemo(() => agruparPorEtapa(oportunidades), [oportunidades])
  const resumen = useMemo(() => calcularResumen(oportunidades), [oportunidades])

  function soltar(etapa: EtapaComercial) {
    const id = arrastrando
    setArrastrando(null)
    setSobre(null)
    if (id === null) return

    const actual = oportunidades.find((o) => o.id === id)
    if (!actual || actual.etapa === etapa) return

    // Soltar en Ganado o Perdido tiene consecuencias sobre el inventario, así
    // que se confirma. El resto del tablero se arrastra sin fricción.
    if (etapa === 'GANADO' && actual.status === 'COTIZACION') {
      if (!window.confirm(`Marcar ${actual.code} como ganado confirmará el pedido y podrá reservar inventario. ¿Continuar?`)) return
    }
    if (etapa === 'PERDIDO') {
      if (!window.confirm(`Marcar ${actual.code} como perdido lo cancelará y liberará el inventario reservado. ¿Continuar?`)) return
    }

    const nuevoOrden = (porEtapa[etapa]?.length ?? 0) * PASO + PASO
    const previas = oportunidades

    // Optimista: la tarjeta se mueve al instante. Si el servidor rechaza, se
    // revierte y se explica — arrastrar y esperar medio segundo se siente roto.
    setOportunidades((p) =>
      p.map((o) => (o.id === id ? { ...o, etapa, ordenTablero: nuevoOrden } : o))
    )
    setAviso(null)

    startTransition(async () => {
      const r = await moverOportunidadAction(id, etapa, nuevoOrden)
      if (r.ok) setAviso({ tipo: 'ok', mensaje: r.detalle })
      else {
        setOportunidades(previas)
        setAviso({ tipo: 'error', mensaje: r.error })
      }
    })
  }

  return (
    <div className="flex flex-col gap-y-3">
      {/* --- Resumen --- */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="bg-surface-subtle rounded-lg px-4 py-3">
          <div className="text-ink-muted mb-1 text-xs">En pipeline</div>
          <div className={`text-ink text-2xl font-semibold ${num}`}>{pesos(resumen.enPipelineCents)}</div>
          <div className={`text-ink-muted mt-0.5 text-xs ${num}`}>
            {resumen.enPipelineCount} oportunidad(es) · COP
          </div>
        </div>
        <div className="bg-surface-subtle rounded-lg px-4 py-3">
          <div className="text-ink-muted mb-1 text-xs">Ganado</div>
          <div className={`text-stock-bodega text-2xl font-semibold ${num}`}>{pesos(resumen.ganadoCents)}</div>
          <div className={`text-ink-muted mt-0.5 text-xs ${num}`}>{resumen.ganadoCount} cerrada(s)</div>
        </div>
        <div className="bg-surface-subtle rounded-lg px-4 py-3">
          <div className="text-ink-muted mb-1 text-xs">Perdido</div>
          <div className={`text-2xl font-semibold ${num} ${resumen.perdidoCount > 0 ? 'text-danger' : 'text-ink-muted'}`}>
            {resumen.perdidoCount}
          </div>
        </div>
        <div className="bg-surface-subtle rounded-lg px-4 py-3">
          <div className="text-ink-muted mb-1 text-xs">Tasa de cierre</div>
          <div className={`text-ink text-2xl font-semibold ${num}`}>
            {resumen.tasaCierre === null ? '—' : `${resumen.tasaCierre}%`}
          </div>
          <div className="text-ink-muted mt-0.5 text-xs">
            {resumen.tasaCierre === null ? 'nada cerrado aún' : 'ganadas sobre cerradas'}
          </div>
        </div>
      </div>

      {/* --- Conmutador de vista --- */}
      <div className="flex items-center gap-2">
        <div className="border-line bg-surface inline-flex rounded-md border p-0.5">
          {(['kanban', 'lista'] as Vista[]).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className={`rounded px-3 py-1 text-sm capitalize transition-colors ${
                vista === v ? 'bg-interactive text-white' : 'text-ink-subtle hover:text-ink'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        {vista === 'kanban' && (
          <span className="text-ink-muted text-xs">Arrastra una tarjeta para cambiarla de etapa.</span>
        )}
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

      {oportunidades.length === 0 ? (
        <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
          <p className="text-ink-subtle text-sm">El embudo está vacío.</p>
          <p className="text-ink-muted mt-1 text-sm">
            Cada cotización que crees aparece aquí como una tarjeta.
          </p>
          <Link href="/ventas/nueva" className="text-interactive mt-3 inline-block text-sm hover:underline">
            Crear la primera cotización
          </Link>
        </div>
      ) : vista === 'kanban' ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {ETAPAS.map((etapa) => {
            const cards = porEtapa[etapa.id] ?? []
            const total = cards.reduce((a, o) => a + o.valorCents, 0)
            const activa = sobre === etapa.id
            return (
              <div
                key={etapa.id}
                onDragOver={(e) => {
                  // Sin preventDefault el navegador no permite soltar aquí.
                  e.preventDefault()
                  setSobre(etapa.id)
                }}
                onDragLeave={() => setSobre((s) => (s === etapa.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault()
                  soltar(etapa.id)
                }}
                className={`flex min-h-48 flex-col rounded-lg border p-2 transition-colors ${
                  activa ? 'border-interactive bg-interactive/5' : 'border-line bg-surface-subtle/50'
                }`}
              >
                <div className="mb-2 px-1">
                  <div className="flex items-baseline justify-between">
                    <span className={`text-xs font-medium ${TONO[etapa.id]}`}>{etapa.label}</span>
                    <span className={`text-ink-muted text-xs ${num}`}>{cards.length}</span>
                  </div>
                  <div className={`text-ink-muted text-[11px] ${num}`}>{pesos(total)}</div>
                </div>

                <div className="flex flex-col gap-1.5">
                  {cards.map((o) => (
                    <div
                      key={o.id}
                      draggable
                      onDragStart={() => setArrastrando(o.id)}
                      onDragEnd={() => { setArrastrando(null); setSobre(null) }}
                      className={`border-line bg-surface cursor-grab rounded-md border px-2.5 py-2 active:cursor-grabbing ${
                        arrastrando === o.id ? 'opacity-40' : ''
                      }`}
                    >
                      <Link
                        href={`/ventas/${o.id}`}
                        draggable={false}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-interactive text-xs font-medium hover:underline ${num}`}
                      >
                        {o.code}
                      </Link>
                      <div className="text-ink truncate text-sm">{o.cliente}</div>
                      <div className={`text-ink-subtle mt-1 flex justify-between text-[11px] ${num}`}>
                        <span>{pesos(o.valorCents)}</span>
                        <span className={o.diasSinAvanzar > 7 ? 'text-danger' : 'text-ink-muted'}>
                          {o.diasSinAvanzar}d
                        </span>
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && (
                    <div className="text-ink-muted px-1 py-3 text-center text-[11px]">
                      {activa ? 'Soltar aquí' : '—'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="border-line bg-surface overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-ink-subtle text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Oportunidad</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Etapa</th>
                <th className={`px-3 py-2 text-right font-medium ${num}`}>Pares</th>
                <th className={`px-3 py-2 text-right font-medium ${num}`}>Valor COP</th>
                <th className={`px-3 py-2 text-right font-medium ${num}`}>Sin avanzar</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {[...oportunidades]
                .sort((a, b) => b.valorCents - a.valorCents)
                .map((o) => (
                  <tr key={o.id} className="hover:bg-surface-hover">
                    <td className="px-3 py-2">
                      <Link href={`/ventas/${o.id}`} className={`text-interactive font-medium hover:underline ${num}`}>
                        {o.code}
                      </Link>
                    </td>
                    <td className="text-ink-subtle px-3 py-2">{o.cliente}</td>
                    <td className={`px-3 py-2 text-xs font-medium ${TONO[o.etapa]}`}>{o.etapa}</td>
                    <td className={`text-ink px-3 py-2 text-right ${num}`}>{o.unidades}</td>
                    <td className={`text-ink px-3 py-2 text-right ${num}`}>{pesos(o.valorCents)}</td>
                    <td className={`px-3 py-2 text-right ${num} ${o.diasSinAvanzar > 7 ? 'text-danger font-medium' : 'text-ink-muted'}`}>
                      {o.diasSinAvanzar} d
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
