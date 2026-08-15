import Link from 'next/link'
import { listarVentas } from '@/lib/db/ventas'

const OPERACION = 'CO'
const num = 'tabular-nums'
const miles = (n: number) => n.toLocaleString('es-CO')

export const dynamic = 'force-dynamic'

/**
 * Bandeja de ventas.
 *
 * La etapa viene de `bi.v_embudo`, la misma vista que alimenta el tablero: no
 * se recalcula aquí. Dos lugares calculando la etapa serían dos verdades.
 */
export default async function VentasPage() {
  const ventas = await listarVentas(OPERACION)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface flex items-start justify-between gap-4 rounded-lg border px-6 py-4">
        <div>
          <h1 className="text-ink text-xl font-semibold">Ventas</h1>
          <p className="text-ink-subtle text-sm">
            De la cotización a la entrega. Reservar compromete inventario; despachar lo
            descuenta y deja asiento en el kardex.
          </p>
        </div>
        <Link
          href="/ventas/nueva"
          className="bg-interactive shrink-0 rounded-md px-4 py-1.5 text-sm font-medium text-white"
        >
          Nueva cotización
        </Link>
      </div>

      {ventas.length === 0 ? (
        <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
          <p className="text-ink-subtle text-sm">Todavía no hay cotizaciones ni pedidos.</p>
        </div>
      ) : (
        <div className="border-line bg-surface overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-ink-subtle text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Pedido</th>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Etapa</th>
                <th className={`px-3 py-2 text-right font-medium ${num}`}>Pedidas</th>
                <th className={`px-3 py-2 text-right font-medium ${num}`}>Reservadas</th>
                <th className={`px-3 py-2 text-right font-medium ${num}`}>Despachadas</th>
                <th className={`px-3 py-2 text-right font-medium ${num}`}>Valor COP</th>
                <th className={`px-3 py-2 text-right font-medium ${num}`}>Sin avanzar</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {ventas.map((v) => (
                <tr key={v.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2">
                    <Link href={`/ventas/${v.id}`} className={`text-interactive font-medium hover:underline ${num}`}>
                      {v.code}
                    </Link>
                  </td>
                  <td className="text-ink-subtle px-3 py-2">{v.cliente}</td>
                  <td className="text-ink-subtle px-3 py-2 text-xs">{v.etapa}</td>
                  <td className={`text-ink px-3 py-2 text-right ${num}`}>{miles(v.unidades)}</td>
                  <td className={`px-3 py-2 text-right ${num} ${v.reservadas > 0 ? 'text-interactive' : 'text-ink-muted'}`}>
                    {miles(v.reservadas)}
                  </td>
                  <td className={`px-3 py-2 text-right ${num} ${v.despachadas > 0 ? 'text-stock-bodega' : 'text-ink-muted'}`}>
                    {miles(v.despachadas)}
                  </td>
                  <td className={`text-ink-subtle px-3 py-2 text-right ${num}`}>
                    {miles(Math.round(v.valorCents / 100))}
                  </td>
                  <td className={`px-3 py-2 text-right ${num} ${v.diasSinAvanzar > 7 ? 'text-danger font-medium' : 'text-ink-muted'}`}>
                    {v.diasSinAvanzar} d
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
