import Link from 'next/link'
import { listarPedidos } from '@/lib/db/purchase-order'
import { Bandeja } from '@/components/pedidos/Bandeja'

const OPERACION = 'CO'

/**
 * Igual que en `/embudo`: sin `searchParams` que la marque como dinámica, Next
 * prerenderizaría la bandeja en el build y mostraría una foto vieja de los
 * pedidos. El estado de un pedido cambia varias veces al día.
 */
export const dynamic = 'force-dynamic'

/**
 * Bandeja de pedidos a la marca.
 *
 * El ciclo de vida completo: Montado → Cantidades revisadas → Aprobado →
 * Despachado. La última transición es la única con efectos fuera del pedido:
 * convierte lo confirmado en existencias en tránsito.
 */
export default async function PedidosPage() {
  const pedidos = await listarPedidos(OPERACION)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface flex items-start justify-between gap-4 rounded-lg border px-6 py-4">
        <div>
          <h1 className="text-ink text-xl font-semibold">Pedidos a la marca</h1>
          <p className="text-ink-subtle text-sm">
            Del montaje al despacho. Al despachar, lo confirmado pasa a tránsito y aparece
            en Inventario.
          </p>
        </div>
        <Link
          href="/pedidos/nuevo"
          className="bg-interactive shrink-0 rounded-md px-4 py-1.5 text-sm font-medium text-white"
        >
          Armar pedido
        </Link>
      </div>

      <Bandeja pedidos={pedidos} />
    </div>
  )
}
