import Link from 'next/link'
import { notFound } from 'next/navigation'
import { obtenerVenta } from '@/lib/db/ventas'
import { AccionesVenta } from '@/components/ventas/AccionesVenta'
import { ETIQUETA_VENTA } from '@/lib/domain/ventas'
import { pesos, totalesDeLinea, totalesDeProforma } from '@/lib/domain/proforma'

const num = 'tabular-nums'

export const dynamic = 'force-dynamic'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * Formatea 'YYYY-MM-DD' SIN pasar por Date.
 *
 * `new Date('2026-12-31')` se interpreta como medianoche UTC, y al mostrarlo
 * en Colombia (UTC−5) sale el 30 de diciembre. Una fecha de validez no tiene
 * hora ni zona: es un día del calendario y se trata como texto.
 */
const fecha = (ymd: string | null) => {
  if (!ymd) return null
  const [a, m, d] = ymd.slice(0, 10).split('-')
  const mes = MESES[Number(m) - 1]
  return mes ? `${d} ${mes} ${a}` : ymd
}

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const venta = await obtenerVenta(Number(id))
  if (!venta) notFound()

  // Los mismos totales que la pantalla de captura, con la MISMA función: si se
  // calcularan aparte, el documento guardado podría mostrar otra cifra que la
  // que el vendedor vio al crearlo.
  const totales = totalesDeProforma(
    venta.lineas.map((l) => ({
      cantidad: l.cantidad,
      precioCents: l.precioCents,
      descuentoPct: l.descuentoPct,
    })),
    venta.descuentoPiePct
  )

  const vence = fecha(venta.validUntil)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <Link href="/ventas" className="text-interactive text-xs hover:underline">
          ← Ventas
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <h1 className={'text-ink text-xl font-semibold ' + num}>{venta.code}</h1>
          <span className="text-ink-subtle text-sm">{venta.cliente}</span>
          <span className="text-ink-muted text-xs">
            {ETIQUETA_VENTA[venta.status]} · etapa {venta.etapa} · {venta.bodega}
            {vence ? ' · válida hasta ' + vence : ''}
          </span>
        </div>
      </div>

      <AccionesVenta venta={venta} />

      <div className="border-line bg-surface overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-subtle text-ink-subtle text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Ítem</th>
              <th className="w-20 px-2 py-2 font-medium">Talla</th>
              <th className={'w-20 px-2 py-2 text-right font-medium ' + num}>Cant.</th>
              <th className={'w-28 px-2 py-2 text-right font-medium ' + num}>P. unit.</th>
              <th className={'w-20 px-2 py-2 text-right font-medium ' + num}>Desc. %</th>
              <th className={'w-32 px-3 py-2 text-right font-medium ' + num}>Subtotal</th>
              <th className={'w-24 px-2 py-2 text-right font-medium ' + num}>Reserv.</th>
              <th className={'w-24 px-2 py-2 text-right font-medium ' + num}>Desp.</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {venta.lineas.map((l) => {
              const t = totalesDeLinea(l)
              return (
                <tr key={l.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <div className="text-ink font-medium">{l.descripcion}</div>
                    <div className={'text-ink-muted text-xs ' + num}>{l.sku}</div>
                  </td>
                  <td className={'text-ink-subtle px-2 py-2 text-xs ' + num}>{l.sizeLabel}</td>
                  <td className={'text-ink px-2 py-2 text-right ' + num}>{l.cantidad}</td>
                  <td className={'text-ink-subtle px-2 py-2 text-right ' + num}>
                    {pesos(l.precioCents)}
                  </td>
                  <td className={'px-2 py-2 text-right ' + num + (l.descuentoPct > 0 ? ' text-danger' : ' text-ink-muted')}>
                    {l.descuentoPct > 0 ? l.descuentoPct + '%' : '—'}
                  </td>
                  <td className={'text-ink px-3 py-2 text-right ' + num}>{pesos(t.netoCents)}</td>
                  <td className={'px-2 py-2 text-right ' + num + (l.reservada > 0 ? ' text-interactive' : ' text-ink-muted')}>
                    {l.reservada}
                  </td>
                  <td className={'px-2 py-2 text-right ' + num + (l.despachada > 0 ? ' text-stock-bodega' : ' text-ink-muted')}>
                    {l.despachada}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* --- Pie del documento --- */}
      <div className="flex justify-end">
        <div className="border-line bg-surface w-full max-w-sm rounded-lg border px-4 py-3">
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
            {venta.descuentoPiePct > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-subtle">Descuento a pie ({venta.descuentoPiePct}%)</dt>
                <dd className="text-danger">−{pesos(totales.descuentoPieCents)}</dd>
              </div>
            )}
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
    </div>
  )
}
