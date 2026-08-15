'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { crearCotizacionAction } from '@/app/ventas/acciones'
import type { MaterialVendible } from '@/lib/db/ventas'
import type { Cliente } from '@/lib/db/clientes'

const num = 'tabular-nums'
const miles = (n: number) => n.toLocaleString('es-CO')

type Celda = { cantidad: number; precioCents: number }

export function GrillaCotizacion({
  clientes,
  materiales,
}: {
  clientes: Cliente[]
  materiales: MaterialVendible[]
}) {
  const router = useRouter()
  const [clienteId, setClienteId] = useState<number | ''>('')
  const [celdas, setCeldas] = useState<Record<number, Celda>>({})
  const [pendiente, startTransition] = useTransition()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; mensaje: string } | null>(null)

  const disponiblePorVariante = useMemo(() => {
    const m = new Map<number, { disponible: number; sku: string }>()
    for (const mat of materiales) {
      for (const t of mat.tallas) m.set(t.variantId, { disponible: t.disponible, sku: t.sku })
    }
    return m
  }, [materiales])

  const resumen = useMemo(() => {
    let unidades = 0
    let valorCents = 0
    let excedidas = 0
    for (const [variantId, celda] of Object.entries(celdas)) {
      if (celda.cantidad <= 0) continue
      unidades += celda.cantidad
      valorCents += celda.cantidad * celda.precioCents
      const info = disponiblePorVariante.get(Number(variantId))
      if (info && celda.cantidad > info.disponible) excedidas++
    }
    return { unidades, valorCents, excedidas }
  }, [celdas, disponiblePorVariante])

  const setCantidad = (variantId: number, cantidad: number) =>
    setCeldas((p) => ({ ...p, [variantId]: { cantidad, precioCents: p[variantId]?.precioCents ?? 0 } }))

  const setPrecio = (variantId: number, pesos: number) =>
    setCeldas((p) => ({
      ...p,
      [variantId]: { cantidad: p[variantId]?.cantidad ?? 0, precioCents: Math.round(pesos * 100) },
    }))

  const guardar = () => {
    if (!clienteId) {
      setAviso({ tipo: 'error', mensaje: 'Elige un cliente.' })
      return
    }
    const lineas = Object.entries(celdas)
      .filter(([, c]) => c.cantidad > 0)
      .map(([variantId, c]) => ({
        variantId: Number(variantId),
        cantidad: c.cantidad,
        precioCents: c.precioCents,
      }))
    if (lineas.length === 0) {
      setAviso({ tipo: 'error', mensaje: 'La cotización no tiene líneas con cantidad.' })
      return
    }

    setAviso(null)
    startTransition(async () => {
      const r = await crearCotizacionAction({ customerId: Number(clienteId), lineas })
      if (r.ok) router.push(`/ventas/${r.id}`)
      else setAviso({ tipo: 'error', mensaje: r.error })
    })
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div className="border-line bg-surface flex flex-wrap items-end gap-3 rounded-lg border px-4 py-3">
        <div className="w-72">
          <label className="text-ink-subtle mb-1 block text-xs">Cliente *</label>
          <select
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : '')}
            className="border-line bg-surface text-ink w-full rounded-md border px-3 py-1.5 text-sm"
          >
            <option value="">Elegir…</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className={`text-right ${num}`}>
          <div className="text-ink-subtle text-xs">Pares</div>
          <div className="text-ink font-medium">{miles(resumen.unidades)}</div>
        </div>
        <div className={`text-right ${num}`}>
          <div className="text-ink-subtle text-xs">Total COP</div>
          <div className="text-ink font-medium">{miles(Math.round(resumen.valorCents / 100))}</div>
        </div>
        {resumen.excedidas > 0 && (
          <span className="border-danger/30 bg-danger-bg text-danger rounded-full border px-2.5 py-1 text-xs font-medium">
            {resumen.excedidas} sobre disponible
          </span>
        )}

        <button
          onClick={guardar}
          disabled={pendiente}
          className="bg-interactive ml-auto rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pendiente ? 'Creando…' : 'Crear cotización'}
        </button>
      </div>

      {aviso && (
        <div className="border-danger/30 bg-danger-bg text-danger rounded-lg border px-4 py-2 text-sm">
          {aviso.mensaje}
        </div>
      )}

      {materiales.length === 0 ? (
        <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
          <p className="text-ink-subtle text-sm">No hay nada disponible para vender.</p>
          <p className="text-ink-muted mt-1 text-sm">
            Sólo aparece lo que está en bodega y sin reservar — ni el tránsito ni lo
            disponible en la marca se pueden comprometer.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-y-2">
          {materiales.map((mat) => (
            <div key={mat.material} className="border-line bg-surface rounded-lg border px-4 py-3">
              <div className="mb-2 flex items-baseline gap-x-2">
                <span className="text-ink font-medium">{mat.descripcion}</span>
                <span className={`text-ink-muted text-xs ${num}`}>
                  {mat.material} · {mat.genero}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {mat.tallas.map((t) => {
                  const celda = celdas[t.variantId]
                  const cantidad = celda?.cantidad ?? 0
                  const excede = cantidad > t.disponible
                  return (
                    <div
                      key={t.variantId}
                      className={`w-24 rounded border px-2 py-1.5 ${
                        excede ? 'border-danger bg-danger-bg' : 'border-line bg-surface'
                      }`}
                    >
                      <div className={`text-ink-subtle text-xs ${num}`}>{t.sizeLabel}</div>
                      <div className={`text-stock-bodega text-[11px] ${num}`}>
                        hay {t.disponible}
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={t.disponible}
                        value={cantidad || ''}
                        onChange={(e) => setCantidad(t.variantId, parseInt(e.target.value, 10) || 0)}
                        placeholder="0"
                        className={`border-line bg-surface text-ink mt-1 w-full rounded border px-1 py-0.5 text-center text-xs ${num}`}
                      />
                      {cantidad > 0 && (
                        <input
                          type="number"
                          min={0}
                          value={celda?.precioCents ? celda.precioCents / 100 : ''}
                          onChange={(e) => setPrecio(t.variantId, parseFloat(e.target.value) || 0)}
                          placeholder="$ c/u"
                          title="Precio unitario en COP"
                          className={`border-line bg-surface text-ink-subtle mt-1 w-full rounded border px-1 py-0.5 text-center text-[11px] ${num}`}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-ink-muted text-xs">
        «Hay» es lo disponible: bodega menos lo ya reservado. El precio se captura a mano
        porque el costeo en COP está en hold — sin costo nacionalizado, cualquier margen
        automático sería falso.
      </p>
    </div>
  )
}
