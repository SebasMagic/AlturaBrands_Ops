'use client'

import { Fragment, useState } from 'react'
import type { MaterialFila, Talla } from '@/lib/db/inventario'

const num = (n: number) => n.toLocaleString('es-CO')

const Miniatura = ({ src, alt }: { src: string | null; alt: string }) =>
  src ? (
    // eslint-disable-next-line @next/next/no-img-element -- catálogo interno, sin optimización de imágenes todavía
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="border-line bg-surface h-10 w-10 shrink-0 rounded border object-cover"
    />
  ) : (
    <div className="border-line bg-surface-subtle text-ink-muted flex h-10 w-10 shrink-0 items-center justify-center rounded border text-xs">
      s/f
    </div>
  )

/** Celda numérica: en cero se apaga para que la vista no grite por nada. */
const Cifra = ({ valor, tono }: { valor: number; tono: string }) => (
  <td className={`px-3 py-2 text-right tabular-nums ${valor > 0 ? tono : 'text-ink-muted'}`}>
    {num(valor)}
  </td>
)

const DesgloseTallas = ({ tallas }: { tallas: Talla[] }) => (
  <div className="bg-surface-subtle/60 px-3 py-3">
    <div className="flex flex-wrap gap-1.5">
      {tallas.map((t) => {
        const hay = t.propio > 0
        const viene = t.transito > 0
        return (
          <div
            key={t.sku}
            title={
              `${t.sku}\nBodega ${t.propio} · reservado ${t.reservado}\n` +
              `Tránsito ${t.transito} · por pedir ${t.proveedor}`
            }
            className={`min-w-16 rounded border px-2 py-1 text-center ${
              hay
                ? 'border-stock-bodega/30 bg-stock-bodega/10'
                : viene
                  ? 'border-stock-transito/30 bg-stock-transito/10'
                  : 'border-line bg-surface'
            }`}
          >
            <div className="text-ink-subtle text-xs tabular-nums">{t.talla}</div>
            <div
              className={`text-sm font-medium tabular-nums ${
                hay ? 'text-stock-bodega' : viene ? 'text-stock-transito' : 'text-ink-muted'
              }`}
            >
              {hay ? t.propio : viene ? `+${t.transito}` : '0'}
            </div>
          </div>
        )
      })}
    </div>
    <p className="text-ink-muted mt-2 text-xs">
      El número es lo que hay en bodega. En ámbar, lo que viene en camino. Pasa el
      cursor para el detalle completo.
    </p>
  </div>
)

/**
 * Tabla de posición de inventario. Client Component porque la fila expandible
 * necesita estado local — pero los DATOS ya llegaron resueltos desde el
 * servidor como props; este componente no consulta nada.
 */
export function TablaPosicion({ materiales }: { materiales: MaterialFila[] }) {
  const [abierto, setAbierto] = useState<string | null>(null)

  if (materiales.length === 0) {
    return (
      <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
        <p className="text-ink-subtle text-sm">Ningún producto con estos filtros.</p>
      </div>
    )
  }

  return (
    <div className="border-line bg-surface overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-subtle text-ink-subtle text-xs">
          <tr>
            <th className="w-8 px-2 py-2" />
            <th className="min-w-72 px-3 py-2 font-medium">Producto</th>
            <th className="w-24 px-3 py-2 font-medium">Marca</th>
            <th className="w-24 px-3 py-2 font-medium">Género</th>
            <th className="w-24 px-3 py-2 text-right font-medium tabular-nums">Bodega</th>
            <th className="w-24 px-3 py-2 text-right font-medium tabular-nums">Tránsito</th>
            <th className="w-28 px-3 py-2 text-right font-medium tabular-nums">Por pedir</th>
            <th className="w-24 px-3 py-2 text-right font-medium tabular-nums">Tallas</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {materiales.map((m) => {
            const expandido = abierto === m.material
            return (
              <Fragment key={m.material}>
                <tr
                  className="hover:bg-surface-hover cursor-pointer"
                  onClick={() => setAbierto(expandido ? null : m.material)}
                >
                  <td className="text-ink-muted px-2 py-2">{expandido ? '▾' : '▸'}</td>

                  <td className="px-3 py-2">
                    <div className="flex items-center gap-x-3">
                      <Miniatura src={m.foto} alt={m.descripcion} />
                      <div className="min-w-0">
                        <span className="text-ink font-medium">
                          {m.modelo} · {m.color}
                        </span>
                        <div className="text-ink-muted text-xs tabular-nums">
                          {m.material} · {m.categoria ?? 'Sin clasificar'}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="text-ink-subtle px-3 py-2 text-xs">{m.marca}</td>
                  <td className="text-ink-subtle px-3 py-2 text-xs">{m.genero}</td>

                  <Cifra valor={m.propio} tono="text-stock-bodega" />
                  <Cifra valor={m.transito} tono="text-stock-transito" />
                  <Cifra valor={m.proveedor} tono="text-stock-marca" />

                  <td
                    className={`px-3 py-2 text-right text-xs tabular-nums ${
                      m.tallasConStock > 0 ? 'text-ink-subtle' : 'text-ink-muted'
                    }`}
                  >
                    {m.tallasConStock}/{m.tallasTotal}
                  </td>
                </tr>

                {expandido && (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <DesgloseTallas tallas={m.tallas} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
