'use client'

import { useEffect, useState } from 'react'
import type { FichaProducto as Ficha } from '@/lib/db/ventas'

const num = 'tabular-nums'

/**
 * Ficha rápida del producto: «¿es este?».
 *
 * Se abre desde el buscador sin perder lo que ya se escribió ni lo ya añadido
 * a la proforma. Muestra la CORRIDA COMPLETA porque al elegir un ítem lo que
 * se quiere saber es si el modelo está bien surtido, y eso sólo se ve con
 * todas las tallas juntas.
 *
 * Las tres naturalezas del inventario responden preguntas distintas
 * (CLAUDE.md §6): lo disponible se vende hoy, el tránsito dice si conviene
 * esperar, y lo de la marca si habría que pedirlo.
 */
export function FichaProducto({
  material,
  onCerrar,
  onAgregar,
}: {
  material: string
  onCerrar: () => void
  onAgregar: (item: {
    variantId: number
    sku: string
    tallaLabel: string
    disponible: number
    descripcion: string
    foto: string | null
  }) => void
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const control = new AbortController()
    setCargando(true)
    setError(null)
    fetch('/api/vendible/ficha?material=' + encodeURIComponent(material), {
      signal: control.signal,
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ficha) setFicha(d.ficha)
        else setError('No se encontró la ficha de este producto.')
      })
      .catch(() => {
        if (!control.signal.aborted) setError('No se pudo cargar la ficha.')
      })
      .finally(() => setCargando(false))
    return () => control.abort()
  }, [material])

  // Escape cierra: en un diálogo que se abre a media captura, obligar a buscar
  // el botón con el ratón rompe el ritmo de teclado de toda la pantalla.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [onCerrar])

  const totalDisponible = ficha?.tallas.reduce((a, t) => a + t.disponible, 0) ?? 0
  const tallasConStock = ficha?.tallas.filter((t) => t.disponible > 0).length ?? 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ficha del producto"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCerrar}
    >
      <div
        // El clic dentro no debe cerrar: sólo el del fondo.
        onClick={(e) => e.stopPropagation()}
        className="border-line bg-surface max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border shadow-xl"
      >
        {cargando ? (
          <div className="text-ink-subtle px-6 py-12 text-center text-sm">Cargando ficha…</div>
        ) : error ? (
          <div className="px-6 py-12 text-center">
            <p className="text-danger text-sm">{error}</p>
            <button
              onClick={onCerrar}
              className="border-line text-ink-subtle hover:bg-surface-hover mt-4 rounded-md border px-3 py-1.5 text-sm"
            >
              Cerrar
            </button>
          </div>
        ) : ficha ? (
          <>
            <div className="border-line flex items-start gap-x-4 border-b px-5 py-4">
              {ficha.foto ? (
                /* eslint-disable-next-line @next/next/no-img-element -- CDN externo, sin optimización todavía */
                <img
                  src={ficha.foto}
                  alt={ficha.modelo + ' ' + ficha.color}
                  className="border-line bg-surface h-24 w-24 shrink-0 rounded border object-cover"
                />
              ) : (
                <div className="border-line bg-surface-subtle text-ink-muted flex h-24 w-24 shrink-0 items-center justify-center rounded border text-xs">
                  sin foto
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="text-ink text-lg font-semibold">
                  {ficha.modelo} · {ficha.color}
                </h2>
                <p className={'text-ink-muted text-xs ' + num}>
                  {ficha.material} · {ficha.genero} · escala {ficha.escala}
                  {ficha.categoria ? ' · ' + ficha.categoria : ''}
                </p>
                <p className={'text-ink-subtle mt-2 text-sm ' + num}>
                  <span className="text-stock-bodega font-medium">{totalDisponible}</span> par(es)
                  disponibles en {tallasConStock} de {ficha.tallas.length} tallas
                </p>
              </div>

              <button
                onClick={onCerrar}
                aria-label="Cerrar ficha"
                className="text-ink-muted hover:text-ink shrink-0 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <table className="w-full text-left text-sm">
              <thead className="bg-surface-subtle text-ink-subtle text-xs">
                <tr>
                  <th className="px-5 py-2 font-medium">Talla</th>
                  <th className={'px-3 py-2 text-right font-medium ' + num}>Disponible</th>
                  <th className={'px-3 py-2 text-right font-medium ' + num}>Tránsito</th>
                  <th className={'px-3 py-2 text-right font-medium ' + num}>Por pedir</th>
                  <th className="w-24 px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {ficha.tallas.map((t) => (
                  <tr key={t.sku} className="hover:bg-surface-hover">
                    <td className="px-5 py-1.5">
                      <div className={'text-ink text-sm ' + num}>{t.tallaLabel}</div>
                      <div className={'text-ink-muted text-xs ' + num}>{t.sku}</div>
                    </td>
                    <td
                      className={
                        'px-3 py-1.5 text-right ' +
                        num +
                        (t.disponible > 0 ? ' text-stock-bodega font-medium' : ' text-ink-muted')
                      }
                    >
                      {t.disponible}
                    </td>
                    <td
                      className={
                        'px-3 py-1.5 text-right ' +
                        num +
                        (t.enTransito > 0 ? ' text-stock-transito' : ' text-ink-muted')
                      }
                    >
                      {t.enTransito}
                    </td>
                    <td
                      className={
                        'px-3 py-1.5 text-right ' +
                        num +
                        (t.enMarca > 0 ? ' text-stock-marca' : ' text-ink-muted')
                      }
                    >
                      {t.enMarca}
                    </td>
                    <td className="px-5 py-1.5 text-right">
                      {t.disponible > 0 ? (
                        <button
                          onClick={() =>
                            onAgregar({
                              variantId: t.variantId,
                              sku: t.sku,
                              tallaLabel: t.tallaLabel,
                              disponible: t.disponible,
                              descripcion: ficha.modelo + ' · ' + ficha.color,
                              foto: ficha.foto,
                            })
                          }
                          className="border-interactive text-interactive hover:bg-interactive/10 rounded border px-2 py-0.5 text-xs"
                        >
                          Agregar
                        </button>
                      ) : (
                        <span className="text-ink-muted text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="text-ink-muted border-line border-t px-5 py-3 text-xs">
              Sólo se puede vender lo <span className="text-stock-bodega">disponible</span>. El
              tránsito viene en camino y lo de la marca habría que pedirlo — ninguno de los dos se
              puede comprometer hoy.
            </p>
          </>
        ) : null}
      </div>
    </div>
  )
}
