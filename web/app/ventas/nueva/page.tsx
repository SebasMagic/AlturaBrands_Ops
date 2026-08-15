import Link from 'next/link'
import { listarClientes } from '@/lib/db/clientes'
import { obtenerCatalogoVendible } from '@/lib/db/ventas'
import { GrillaCotizacion } from '@/components/ventas/GrillaCotizacion'

const OPERACION = 'CO'

type BusquedaParams = Promise<Record<string, string | string[] | undefined>>

function unoSolo(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function NuevaVentaPage({ searchParams }: { searchParams: BusquedaParams }) {
  const sp = await searchParams
  const q = unoSolo(sp.q)

  const [clientes, materiales] = await Promise.all([
    listarClientes(OPERACION),
    obtenerCatalogoVendible(OPERACION, q),
  ])

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <Link href="/ventas" className="text-interactive text-xs hover:underline">
          ← Ventas
        </Link>
        <h1 className="text-ink mt-1 text-xl font-semibold">Nueva cotización</h1>
        <p className="text-ink-subtle text-sm">
          Sólo aparece lo vendible hoy: bodega menos lo ya reservado.
        </p>
      </div>

      {clientes.length === 0 ? (
        <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
          <p className="text-ink-subtle text-sm">Primero hay que crear un cliente.</p>
          <Link href="/clientes" className="text-interactive mt-2 inline-block text-sm hover:underline">
            Ir a Clientes
          </Link>
        </div>
      ) : (
        <GrillaCotizacion clientes={clientes} materiales={materiales} />
      )}
    </div>
  )
}
