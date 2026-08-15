import Link from 'next/link'
import { notFound } from 'next/navigation'
import { obtenerVenta } from '@/lib/db/ventas'
import { AccionesVenta } from '@/components/ventas/AccionesVenta'
import { ETIQUETA_VENTA } from '@/lib/domain/ventas'

const num = 'tabular-nums'
const miles = (n: number) => n.toLocaleString('es-CO')

export const dynamic = 'force-dynamic'

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const venta = await obtenerVenta(Number(id))
  if (!venta) notFound()

  const total = venta.lineas.reduce((a, l) => a + l.cantidad * l.precioCents, 0)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <Link href="/ventas" className="text-interactive text-xs hover:underline">
          ← Ventas
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <h1 className={`text-ink text-xl font-semibold ${num}`}>{venta.code}</h1>
          <span className="text-ink-subtle text-sm">{venta.cliente}</span>
          <span className="text-ink-muted text-xs">
            {ETIQUETA_VENTA[venta.status]} · etapa {venta.etapa} · {venta.bodega}
          </span>
        </div>
      </div>

      <AccionesVenta venta={venta} />

      <div className="border-line bg-surface overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-subtle text-ink-subtle text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Producto</th>
              <th className="px-3 py-2 font-medium">Talla</th>
              <th className={`px-3 py-2 text-right font-medium ${num}`}>Pedidas</th>
              <th className={`px-3 py-2 text-right font-medium ${num}`}>Reservadas</th>
              <th className={`px-3 py-2 text-right font-medium ${num}`}>Despachadas</th>
              <th className={`px-3 py-2 text-right font-medium ${num}`}>Precio COP</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {venta.lineas.map((l) => (
              <tr key={l.id} className="hover:bg-surface-hover">
                <td className="px-3 py-2">
                  <div className="text-ink font-medium">{l.descripcion}</div>
                  <div className={`text-ink-muted text-xs ${num}`}>{l.sku}</div>
                </td>
                <td className={`text-ink-subtle px-3 py-2 text-xs ${num}`}>{l.sizeLabel}</td>
                <td className={`text-ink px-3 py-2 text-right ${num}`}>{l.cantidad}</td>
                <td className={`px-3 py-2 text-right ${num} ${l.reservada > 0 ? 'text-interactive' : 'text-ink-muted'}`}>
                  {l.reservada}
                </td>
                <td className={`px-3 py-2 text-right ${num} ${l.despachada > 0 ? 'text-stock-bodega' : 'text-ink-muted'}`}>
                  {l.despachada}
                </td>
                <td className={`text-ink-subtle px-3 py-2 text-right ${num}`}>
                  {miles(Math.round(l.precioCents / 100))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-subtle text-ink text-sm">
            <tr>
              <td colSpan={5} className="px-3 py-2 text-right font-medium">
                Total COP
              </td>
              <td className={`px-3 py-2 text-right font-semibold ${num}`}>
                {miles(Math.round(total / 100))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
