import { Suspense } from 'react'
import Link from 'next/link'
import { obtenerCatalogoPedido } from '@/lib/db/pedidos'
import { Filtros } from '@/components/pedidos/Filtros'
import { GrillaPedido } from '@/components/pedidos/GrillaPedido'

const OPERACION = 'CO'
const MARCA = 'KEEN'

type BusquedaParams = Promise<Record<string, string | string[] | undefined>>

function unoSolo(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * Armar pedido a la marca.
 *
 * Portada de `src/admin/routes/pedidos/page.tsx`. El comprador teclea bultos
 * y las tallas se calculan solas desde la curva; puede ajustar una celda
 * suelta y la línea queda marcada.
 *
 * El pedido nace en DRAFT (Montado). Su ciclo de vida sigue en la bandeja.
 */
export default async function NuevoPedidoPage({ searchParams }: { searchParams: BusquedaParams }) {
  const sp = await searchParams

  const { tallas, curvas, materiales } = await obtenerCatalogoPedido({
    operacion: OPERACION,
    marca: MARCA,
    genero: unoSolo(sp.genero),
    q: unoSolo(sp.q),
  })

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <Link href="/pedidos" className="text-interactive text-xs hover:underline">
          ← Bandeja de pedidos
        </Link>
        <h1 className="text-ink mt-1 text-xl font-semibold">Armar pedido</h1>
        <p className="text-ink-subtle text-sm">
          Teclea bultos y las tallas se calculan con la curva. Enter baja al siguiente.
        </p>
      </div>

      <Suspense>
        <Filtros />
      </Suspense>

      <GrillaPedido operacion={OPERACION} marca={MARCA} tallas={tallas} curvas={curvas} materiales={materiales} />
    </div>
  )
}
