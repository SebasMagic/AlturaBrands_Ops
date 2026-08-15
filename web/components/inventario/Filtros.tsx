'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const TODOS = '__todos__'

/**
 * Único componente cliente del filtrado. La página en sí es un Server
 * Component: cada cambio de filtro navega con nuevos `searchParams` y el
 * servidor vuelve a consultar `bi.v_posicion` — el navegador nunca habla con
 * Postgres (CLAUDE.md §4).
 *
 * El campo de texto sigue con debounce local antes de navegar: sin eso cada
 * tecla dispara una consulta sobre 3.064 variantes, igual que en la versión
 * anterior sobre el admin de Medusa.
 */
export function Filtros({
  marcas,
  generos,
  categorias,
}: {
  marcas: string[]
  generos: string[]
  categorias: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [q, setQ] = useState(searchParams.get('q') ?? '')

  useEffect(() => {
    const t = setTimeout(() => {
      aplicar('q', q.trim() || null)
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function aplicar(clave: string, valor: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (valor) params.set(clave, valor)
    else params.delete(clave)
    router.push(`${pathname}?${params.toString()}`)
  }

  const marcaActual = searchParams.get('marca') ?? TODOS
  const generoActual = searchParams.get('genero') ?? TODOS
  const categoriaActual = searchParams.get('categoria') ?? TODOS
  const conStockActual = searchParams.get('con_stock') === 'true'

  return (
    <div className="border-line bg-surface flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <input
        type="text"
        placeholder="Buscar modelo, color o material…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="border-line bg-surface text-ink placeholder:text-ink-muted focus:border-interactive focus:ring-interactive/30 w-64 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2"
      />

      <select
        value={marcaActual}
        onChange={(e) => aplicar('marca', e.target.value === TODOS ? null : e.target.value)}
        className="border-line bg-surface text-ink focus:border-interactive focus:ring-interactive/30 w-40 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2"
      >
        <option value={TODOS}>Todas las marcas</option>
        {marcas.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <select
        value={generoActual}
        onChange={(e) => aplicar('genero', e.target.value === TODOS ? null : e.target.value)}
        className="border-line bg-surface text-ink focus:border-interactive focus:ring-interactive/30 w-40 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2"
      >
        <option value={TODOS}>Todos los géneros</option>
        {generos.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>

      <select
        value={categoriaActual}
        onChange={(e) => aplicar('categoria', e.target.value === TODOS ? null : e.target.value)}
        className="border-line bg-surface text-ink focus:border-interactive focus:ring-interactive/30 w-52 rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2"
      >
        <option value={TODOS}>Todas las categorías</option>
        {categorias.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <label className="text-ink-subtle flex cursor-pointer items-center gap-x-2 text-sm">
        <input
          type="checkbox"
          checked={conStockActual}
          onChange={(e) => aplicar('con_stock', e.target.checked ? 'true' : null)}
          className="accent-interactive h-4 w-4"
        />
        Solo con existencia
      </label>
    </div>
  )
}
