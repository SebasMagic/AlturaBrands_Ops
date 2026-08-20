'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { crearCotizacionAction } from '@/app/ventas/acciones'
import type { Cliente } from '@/lib/db/clientes'
import type { ResultadoBusqueda } from '@/lib/db/ventas'
import {
  pesos,
  totalesDeLinea,
  totalesDeProforma,
  validarProforma,
  type LineaProforma,
} from '@/lib/domain/proforma'

const num = 'tabular-nums'
const campo =
  'border-line bg-surface text-ink focus:border-interactive focus:ring-interactive/30 rounded-md border px-2 py-1 text-sm outline-none focus:ring-2'

/**
 * Proforma.
 *
 * Reemplaza la pantalla anterior, que volcaba los 269 materiales con una caja
 * por talla: con ese grano no se arma un pedido, sólo se pierde uno. Aquí se
 * BUSCA lo que se quiere y se añade línea a línea, como en cualquier documento
 * comercial.
 */
export function Proforma({ clientes }: { clientes: Cliente[] }) {
  const router = useRouter()

  const [clienteId, setClienteId] = useState<number | ''>('')
  const [validUntil, setValidUntil] = useState('')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState<LineaProforma[]>([])
  const [descuentoPie, setDescuentoPie] = useState(0)

  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([])
  const [buscando, setBuscando] = useState(false)
  const [abierto, setAbierto] = useState(false)

  const [guardando, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const buscadorRef = useRef<HTMLInputElement | null>(null)

  // --- Búsqueda ------------------------------------------------------------
  useEffect(() => {
    const termino = q.trim()
    if (termino.length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    // AbortController además del debounce: sin él, la respuesta lenta de hace
    // tres letras puede llegar DESPUÉS de la actual y pisar los resultados.
    const control = new AbortController()
    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await fetch('/api/vendible?q=' + encodeURIComponent(termino), {
          signal: control.signal,
        })
        const d = await r.json()
        setResultados(d.resultados ?? [])
        setAbierto(true)
      } catch {
        // Abortada: la reemplaza una búsqueda más reciente. No es un error.
      } finally {
        setBuscando(false)
      }
    }, 220)
    return () => {
      clearTimeout(t)
      control.abort()
    }
  }, [q])

  const totales = useMemo(() => totalesDeProforma(lineas, descuentoPie), [lineas, descuentoPie])
  const validacion = useMemo(() => validarProforma(lineas), [lineas])

  // --- Líneas --------------------------------------------------------------
  function agregar(r: ResultadoBusqueda) {
    setLineas((prev) => {
      // Si el SKU ya está, se suma una unidad en vez de duplicar la fila: dos
      // líneas del mismo SKU en una proforma son un error de captura.
      const i = prev.findIndex((l) => l.variantId === r.variantId)
      if (i >= 0) {
        const copia = [...prev]
        const actual = copia[i]!
        copia[i] = { ...actual, cantidad: Math.min(actual.disponible, actual.cantidad + 1) }
        return copia
      }
      return [
        ...prev,
        {
          key: 'v' + r.variantId,
          variantId: r.variantId,
          sku: r.sku,
          descripcion: r.descripcion,
          tallaLabel: r.tallaLabel,
          disponible: r.disponible,
          cantidad: 1,
          precioCents: 0,
          descuentoPct: 0,
        },
      ]
    })
    setQ('')
    setResultados([])
    setAbierto(false)
    buscadorRef.current?.focus()
  }

  const actualizar = (key: string, cambios: Partial<LineaProforma>) =>
    setLineas((p) => p.map((l) => (l.key === key ? { ...l, ...cambios } : l)))

  const quitar = (key: string) => setLineas((p) => p.filter((l) => l.key !== key))

  // --- Guardar -------------------------------------------------------------
  function guardar() {
    setError(null)
    if (!clienteId) {
      setError('Elige un cliente.')
      return
    }
    if (!validacion.ok) {
      const p = validacion.problemas[0]
      setError(
        validacion.conCantidad.length === 0
          ? 'La proforma no tiene ítems con cantidad.'
          : 'Revisa ' + p?.linea.sku + ': ' + p?.motivo + '.'
      )
      return
    }

    startTransition(async () => {
      const r = await crearCotizacionAction({
        customerId: Number(clienteId),
        descuentoPiePct: descuentoPie,
        validUntil: validUntil || null,
        notes: notas || undefined,
        lineas: validacion.conCantidad.map((l) => ({
          variantId: l.variantId,
          cantidad: l.cantidad,
          precioCents: l.precioCents,
          descuentoPct: l.descuentoPct,
        })),
      })
      if (r.ok) router.push('/ventas/' + r.id)
      else setError(r.error)
    })
  }

  return (
    <div className="flex flex-col gap-y-3">
      {/* --- Cabecera del documento --- */}
      <div className="border-line bg-surface rounded-lg border px-4 py-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="text-ink-subtle mb-1 block text-xs">Cliente *</label>
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : '')}
              className={campo + ' w-full'}
            >
              <option value="">Elegir…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-ink-subtle mb-1 block text-xs">Válida hasta</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className={campo + ' w-full'}
            />
          </div>
          <div>
            <label className="text-ink-subtle mb-1 block text-xs">Moneda</label>
            <div className="text-ink px-2 py-1 text-sm">COP</div>
          </div>
        </div>
      </div>

      {/* --- Buscador --- */}
      <div className="border-line bg-surface relative rounded-lg border px-4 py-3">
        <label className="text-ink-subtle mb-1 block text-xs">Agregar ítem</label>
        <input
          ref={buscadorRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => resultados.length > 0 && setAbierto(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && resultados[0]) {
              e.preventDefault()
              agregar(resultados[0])
            }
            if (e.key === 'Escape') setAbierto(false)
          }}
          placeholder="Buscar por SKU, modelo, color, material o talla…   Enter agrega el primero"
          className={campo + ' w-full'}
        />
        {buscando && <span className="text-ink-muted mt-1 block text-xs">Buscando…</span>}

        {abierto && resultados.length > 0 && (
          <div className="border-line bg-surface absolute right-4 left-4 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border shadow-lg">
            {resultados.map((r) => (
              <button
                key={r.variantId}
                onClick={() => agregar(r)}
                className="hover:bg-surface-hover flex w-full items-center gap-x-3 px-3 py-2 text-left"
              >
                <span className="text-ink min-w-0 flex-1 truncate text-sm">{r.descripcion}</span>
                <span className={'text-ink-subtle text-xs ' + num}>{r.tallaLabel}</span>
                <span className={'text-ink-muted w-32 text-right text-xs ' + num}>{r.sku}</span>
                <span className={'text-stock-bodega w-16 text-right text-xs ' + num}>
                  hay {r.disponible}
                </span>
              </button>
            ))}
          </div>
        )}
        {abierto && !buscando && q.trim().length >= 2 && resultados.length === 0 && (
          <div className="text-ink-muted mt-1 text-xs">
            Nada vendible con ese término. Sólo aparece lo que hay en bodega sin reservar.
          </div>
        )}
      </div>

      {/* --- Ítems --- */}
      <div className="border-line bg-surface overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-subtle text-ink-subtle text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Ítem</th>
              <th className="w-20 px-2 py-2 font-medium">Talla</th>
              <th className={'w-16 px-2 py-2 text-right font-medium ' + num}>Disp.</th>
              <th className={'w-20 px-2 py-2 text-right font-medium ' + num}>Cant.</th>
              <th className={'w-28 px-2 py-2 text-right font-medium ' + num}>P. unit.</th>
              <th className={'w-20 px-2 py-2 text-right font-medium ' + num}>Desc. %</th>
              <th className={'w-32 px-3 py-2 text-right font-medium ' + num}>Subtotal</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {lineas.length === 0 && (
              <tr>
                <td colSpan={8} className="text-ink-muted px-3 py-10 text-center text-sm">
                  Sin ítems. Busca arriba y añade el primero.
                </td>
              </tr>
            )}
            {lineas.map((l) => {
              const t = totalesDeLinea(l)
              const excede = l.cantidad > l.disponible
              return (
                <tr key={l.key} className="hover:bg-surface-hover">
                  <td className="px-3 py-1.5">
                    <div className="text-ink font-medium">{l.descripcion}</div>
                    <div className={'text-ink-muted text-xs ' + num}>{l.sku}</div>
                  </td>
                  <td className={'text-ink-subtle px-2 py-1.5 text-xs ' + num}>{l.tallaLabel}</td>
                  <td className={'text-stock-bodega px-2 py-1.5 text-right text-xs ' + num}>
                    {l.disponible}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      max={l.disponible}
                      value={l.cantidad || ''}
                      onChange={(e) =>
                        actualizar(l.key, { cantidad: parseInt(e.target.value, 10) || 0 })
                      }
                      className={
                        'w-full rounded border px-1 py-0.5 text-right text-sm ' +
                        num +
                        (excede
                          ? ' border-danger bg-danger-bg text-danger'
                          : ' border-line bg-surface text-ink')
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={l.precioCents ? l.precioCents / 100 : ''}
                      onChange={(e) =>
                        actualizar(l.key, {
                          precioCents: Math.round((parseFloat(e.target.value) || 0) * 100),
                        })
                      }
                      placeholder="0"
                      className={
                        'border-line bg-surface text-ink w-full rounded border px-1 py-0.5 text-right text-sm ' +
                        num
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={l.descuentoPct || ''}
                      onChange={(e) =>
                        actualizar(l.key, {
                          descuentoPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)),
                        })
                      }
                      placeholder="0"
                      className={
                        'border-line bg-surface text-ink w-full rounded border px-1 py-0.5 text-right text-sm ' +
                        num
                      }
                    />
                  </td>
                  <td className={'px-3 py-1.5 text-right ' + num}>
                    <div className="text-ink">{pesos(t.netoCents)}</div>
                    {t.descuentoCents > 0 && (
                      <div className="text-ink-muted text-xs line-through">
                        {pesos(t.brutoCents)}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => quitar(l.key)}
                      title="Quitar ítem"
                      className="text-ink-muted hover:text-danger text-sm"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* --- Pie: notas y totales --- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="border-line bg-surface rounded-lg border px-4 py-3">
          <label className="text-ink-subtle mb-1 block text-xs">Notas de la proforma</label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={4}
            placeholder="Condiciones de pago, plazo de entrega, observaciones…"
            className={campo + ' w-full resize-y'}
          />
        </div>

        <div className="border-line bg-surface rounded-lg border px-4 py-3">
          <dl className={'flex flex-col gap-1.5 text-sm ' + num}>
            <div className="flex justify-between">
              <dt className="text-ink-subtle">Subtotal</dt>
              <dd className="text-ink">{pesos(totales.subtotalCents)}</dd>
            </div>
            {totales.descuentoLineasCents > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-subtle">Descuentos por ítem</dt>
                <dd className="text-danger">−{pesos(totales.descuentoLineasCents)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-ink-subtle flex items-center gap-x-2">
                Descuento a pie
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={descuentoPie || ''}
                  onChange={(e) =>
                    setDescuentoPie(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))
                  }
                  placeholder="0"
                  className={
                    'border-line bg-surface text-ink w-16 rounded border px-1 py-0.5 text-right text-sm ' +
                    num
                  }
                />
                <span className="text-ink-muted text-xs">%</span>
              </dt>
              <dd className={totales.descuentoPieCents > 0 ? 'text-danger' : 'text-ink-muted'}>
                −{pesos(totales.descuentoPieCents)}
              </dd>
            </div>
            <div className="border-line mt-1 flex justify-between border-t pt-2">
              <dt className="text-ink font-semibold">Total COP</dt>
              <dd className="text-ink text-lg font-semibold">{pesos(totales.totalCents)}</dd>
            </div>
            <div className="text-ink-muted flex justify-between text-xs">
              <dt>{totales.lineas} ítem(s)</dt>
              <dd>{totales.unidades} par(es)</dd>
            </div>
          </dl>
        </div>
      </div>

      {error && (
        <div className="border-danger/30 bg-danger-bg text-danger rounded-lg border px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={guardar}
          disabled={guardando || lineas.length === 0}
          className="bg-interactive rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {guardando ? 'Creando…' : 'Crear proforma'}
        </button>
        {validacion.problemas.length > 0 && (
          <span className="text-danger text-xs">
            {validacion.problemas.length} ítem(s) con problema
          </span>
        )}
        <span className="text-ink-muted ml-auto text-xs">
          «Disp.» es bodega menos lo ya reservado. El stock se compromete al reservar, no aquí.
        </span>
      </div>
    </div>
  )
}
