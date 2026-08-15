import { Suspense } from 'react'
import { obtenerDimensiones, obtenerPosicion } from '@/lib/db/inventario'
import { calcularResumen, elegirMarcaEnJuego } from '@/lib/domain/inventario'
import { Filtros } from '@/components/inventario/Filtros'
import { Tarjetas } from '@/components/inventario/Tarjetas'
import { TablaPosicion } from '@/components/inventario/Tabla'

const OPERACION = 'CO'

type BusquedaParams = Promise<Record<string, string | string[] | undefined>>

/** Un searchParam puede llegar como array si se repite en la URL; nos quedamos con el primero. */
function unoSolo(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * Posición de inventario por producto — la pantalla del día a día.
 *
 * Server Component: consulta `bi.v_posicion` directamente en el servidor y
 * renderiza. Cada cambio de filtro es una navegación con nuevos
 * `searchParams`, no una llamada `fetch` desde el navegador — el navegador
 * nunca habla con Postgres (CLAUDE.md §4).
 *
 * Portada de `src/admin/routes/inventario/page.tsx` (versión Medusa). Misma
 * UI, mismas reglas de negocio (CLAUDE.md §6); cambia solo cómo llegan los
 * datos.
 */
export default async function InventarioPage({
  searchParams,
}: {
  searchParams: BusquedaParams
}) {
  const sp = await searchParams

  const filtros = {
    operacion: OPERACION,
    marca: unoSolo(sp.marca),
    genero: unoSolo(sp.genero),
    categoria: unoSolo(sp.categoria),
    q: unoSolo(sp.q),
    soloConStock: unoSolo(sp.con_stock) === 'true',
  }

  const [materiales, dimensiones] = await Promise.all([
    obtenerPosicion(filtros),
    obtenerDimensiones(OPERACION),
  ])

  const resumen = calcularResumen(materiales)
  const marcaEnJuego = elegirMarcaEnJuego(filtros.marca, dimensiones.marcas)

  return (
    <div className="flex flex-col gap-y-3">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <h1 className="text-ink text-xl font-semibold">Inventario</h1>
        <p className="text-ink-subtle text-sm">
          Posición por producto: lo que está en bodega, lo que viene navegando y lo
          que sigue disponible en la marca.
        </p>
      </div>

      <Tarjetas resumen={resumen} marcaEnJuego={marcaEnJuego} />

      <Suspense>
        <Filtros marcas={dimensiones.marcas} generos={dimensiones.generos} categorias={dimensiones.categorias} />
      </Suspense>

      {filtros.soloConStock && materiales.length === 0 ? (
        <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
          <p className="text-ink-subtle text-sm">Ningún producto con estos filtros.</p>
          <p className="text-ink-muted mt-1 text-sm">
            Tienes activo «solo con existencia»: prueba a quitarlo para ver lo que
            está en tránsito o disponible en la marca.
          </p>
        </div>
      ) : (
        <TablaPosicion materiales={materiales} />
      )}
    </div>
  )
}
