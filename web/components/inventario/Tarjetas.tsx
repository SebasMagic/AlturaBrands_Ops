import type { Resumen } from '@/lib/domain/inventario'

const num = (n: number) => n.toLocaleString('es-CO')

const Tarjeta = ({
  etiqueta,
  valor,
  tono,
  nota,
}: {
  etiqueta: string
  valor: number
  tono: string
  nota?: string
}) => (
  <div className="bg-surface-subtle rounded-lg px-4 py-3">
    <div className="text-ink-muted mb-1 text-xs">{etiqueta}</div>
    <div className={`text-2xl font-semibold tabular-nums ${tono}`}>{num(valor)}</div>
    {nota && <div className="text-ink-muted mt-0.5 text-xs">{nota}</div>}
  </div>
)

/** Puramente de servidor: sin estado, sin interactividad. */
export function Tarjetas({ resumen, marcaEnJuego }: { resumen: Resumen; marcaEnJuego: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      <Tarjeta
        etiqueta="En bodega"
        valor={resumen.propio}
        tono="text-stock-bodega"
        nota={resumen.reservado > 0 ? `${num(resumen.reservado)} reservados` : undefined}
      />
      <Tarjeta
        etiqueta="En tránsito"
        valor={resumen.transito}
        tono="text-stock-transito"
        nota="despachado, sin recibir"
      />
      <Tarjeta
        etiqueta="Por pedir en la marca"
        valor={resumen.proveedor}
        tono="text-ink"
        nota={marcaEnJuego ? `disponible en ${marcaEnJuego}` : 'disponible en la marca'}
      />
      <Tarjeta etiqueta="Productos" valor={resumen.materiales} tono="text-ink" nota="modelo + color" />
      <Tarjeta
        etiqueta="Sin un par propio"
        valor={resumen.sinStockPropio}
        tono={resumen.sinStockPropio > 0 ? 'text-danger' : 'text-ink-muted'}
        nota={
          resumen.materiales > 0
            ? `${Math.round((100 * resumen.sinStockPropio) / resumen.materiales)}% del catálogo`
            : undefined
        }
      />
    </div>
  )
}
