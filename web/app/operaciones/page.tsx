import {
  obtenerDescuadresReserva,
  obtenerDetalleEmbudo,
  obtenerResumenEmbudo,
  type Etapa,
} from '@/lib/db/embudo'

const OPERACION = 'CO'

/**
 * Sin esto Next prerenderiza esta página en el build y sirve para siempre los
 * datos del momento de compilar. No tiene `searchParams` ni ninguna otra API
 * dinámica que la marque sola, así que hay que declararlo: un tablero de
 * operación tiene que leer la base en cada visita.
 */
export const dynamic = 'force-dynamic'

const num = 'tabular-nums'
const miles = (n: number) => n.toLocaleString('es-CO')
const pesos = (cents: number) =>
  (cents / 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })

/**
 * Orden canónico de las etapas — el mismo `etapa_orden` de la vista, para que
 * el tablero muestre las etapas vacías también. Un embudo con huecos invisibles
 * miente sobre dónde está el cuello de botella.
 */
const ETAPAS: { etapa: Etapa; orden: number }[] = [
  { etapa: 'COTIZACION', orden: 1 },
  { etapa: 'PEDIDO', orden: 2 },
  { etapa: 'RESERVADO', orden: 3 },
  { etapa: 'EMPACADO', orden: 4 },
  { etapa: 'DESPACHO PARCIAL', orden: 5 },
  { etapa: 'DESPACHADO', orden: 6 },
  { etapa: 'ENTREGADO', orden: 7 },
]

const TONO: Record<Etapa, string> = {
  COTIZACION: 'text-ink-muted',
  PEDIDO: 'text-ink-subtle',
  RESERVADO: 'text-interactive',
  EMPACADO: 'text-stock-transito',
  'DESPACHO PARCIAL': 'text-stock-transito',
  DESPACHADO: 'text-stock-bodega',
  ENTREGADO: 'text-stock-bodega',
  CANCELADO: 'text-danger',
}

/**
 * Embudo de ventas y despacho.
 *
 * La etapa NO se guarda en ninguna columna: se deriva de los hechos
 * (reservas, empaques, despachos, entregas) y se calcula por CANTIDADES, no
 * por fechas — un pedido con 90 de 100 pares despachados está a medias, y esa
 * distinción es justo lo que el coordinador necesita ver (CLAUDE.md §6).
 */
export default async function EmbudoPage() {
  const [resumen, detalle, descuadres] = await Promise.all([
    obtenerResumenEmbudo(OPERACION),
    obtenerDetalleEmbudo(OPERACION),
    obtenerDescuadresReserva(),
  ])

  const porEtapa = new Map(resumen.map((r) => [r.etapa, r]))
  const totalPedidos = resumen.reduce((a, r) => (r.etapa === 'CANCELADO' ? a : a + r.pedidos), 0)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <h1 className="text-ink text-xl font-semibold">Operaciones</h1>
        <p className="text-ink-subtle text-sm">
          Del pedido en firme a la entrega. La etapa se <strong>deriva</strong> de las
          cantidades reales — reservas, empaques, despachos — no de un estado escrito a
          mano. Por eso aquí no se arrastra nada: mandan los hechos.
        </p>
      </div>

      {/* Cuadre de reservas: sólo aparece si hay algo roto. */}
      {descuadres.length > 0 && (
        <div className="border-danger/30 bg-danger-bg rounded-lg border px-4 py-3">
          <p className="text-danger text-sm font-medium">
            {descuadres.length} descuadre(s) entre el stock reservado y las reservas activas
          </p>
          <p className="text-ink-subtle mt-1 text-xs">
            Esto es un bug, no una discrepancia aceptable: hay un camino que movió el
            contador sin registrar la reserva.
          </p>
          <ul className={`text-ink-subtle mt-2 text-xs ${num}`}>
            {descuadres.slice(0, 5).map((d) => (
              <li key={`${d.sku}-${d.bodega}`}>
                {d.sku} · {d.bodega}: stock dice {d.reservadoEnStock}, reservas suman{' '}
                {d.reservadoEnReservas}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tablero por etapa */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
        {ETAPAS.map(({ etapa }) => {
          const r = porEtapa.get(etapa)
          const vacia = !r || r.pedidos === 0
          return (
            <div key={etapa} className="bg-surface-subtle rounded-lg px-3 py-3">
              <div className="text-ink-muted mb-1 text-[11px] leading-tight">{etapa}</div>
              <div className={`text-2xl font-semibold ${num} ${vacia ? 'text-ink-muted' : TONO[etapa]}`}>
                {r?.pedidos ?? 0}
              </div>
              {!vacia && (
                <div className={`text-ink-muted mt-0.5 text-xs ${num}`}>
                  {miles(r.unidades)} pares
                  {r.atascados > 0 && (
                    <span className="text-danger"> · {r.atascados} atascado</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Detalle */}
      {detalle.length === 0 ? (
        <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
          <p className="text-ink-subtle text-sm">Todavía no hay pedidos de venta.</p>
          <p className="text-ink-muted mt-1 text-sm">
            El embudo se llena solo a medida que se cotiza, se reserva y se despacha.
          </p>
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
              {detalle.map((f) => (
                <tr key={f.orderId} className="hover:bg-surface-hover">
                  <td className={`text-ink px-3 py-2 font-medium ${num}`}>{f.code}</td>
                  <td className="text-ink-subtle px-3 py-2">{f.cliente}</td>
                  <td className={`px-3 py-2 text-xs font-medium ${TONO[f.etapa]}`}>{f.etapa}</td>
                  <td className={`text-ink px-3 py-2 text-right ${num}`}>{miles(f.unidades)}</td>
                  <td className={`px-3 py-2 text-right ${num} ${f.reservadas > 0 ? 'text-interactive' : 'text-ink-muted'}`}>
                    {miles(f.reservadas)}
                  </td>
                  <td className={`px-3 py-2 text-right ${num} ${f.despachadas > 0 ? 'text-stock-bodega' : 'text-ink-muted'}`}>
                    {miles(f.despachadas)}
                  </td>
                  <td className={`text-ink-subtle px-3 py-2 text-right ${num}`}>{pesos(f.valorCents)}</td>
                  <td
                    className={`px-3 py-2 text-right ${num} ${
                      f.diasSinAvanzar > 7 ? 'text-danger font-medium' : 'text-ink-muted'
                    }`}
                  >
                    {f.diasSinAvanzar} d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detalle.length > 0 && (
        <p className="text-ink-muted text-xs">
          {totalPedidos} pedidos activos · en rojo, los que llevan más de 7 días sin avanzar
        </p>
      )}
    </div>
  )
}
