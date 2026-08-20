import Link from 'next/link'
import { listarClientes } from '@/lib/db/clientes'
import { Proforma } from '@/components/ventas/Proforma'

const OPERACION = 'CO'

export const dynamic = 'force-dynamic'

/**
 * Nueva proforma.
 *
 * Ya no carga el catálogo entero: con 269 materiales, volcarlos todos hacía la
 * pantalla inusable y además obligaba a traerse miles de filas para que el
 * vendedor mirase tres. Ahora los ítems entran por búsqueda, bajo demanda.
 */
export default async function NuevaVentaPage() {
  const clientes = await listarClientes(OPERACION)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <Link href="/ventas" className="text-interactive text-xs hover:underline">
          ← Ventas
        </Link>
        <h1 className="text-ink mt-1 text-xl font-semibold">Nueva proforma</h1>
        <p className="text-ink-subtle text-sm">
          Busca los ítems por SKU, modelo, color o talla. Sólo aparece lo vendible hoy:
          bodega menos lo ya reservado.
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
        <Proforma clientes={clientes} />
      )}
    </div>
  )
}
