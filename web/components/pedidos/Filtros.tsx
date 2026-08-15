'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

const TODOS = '__todos__'
const GENEROS = ['MEN', 'WOMEN', 'CHILDREN', 'YOUTH', 'TOTS']

/**
 * Igual que `components/inventario/Filtros.tsx`: navega con `searchParams`,
 * el servidor vuelve a consultar el catálogo. Filtrar aquí no es solo mostrar
 * u ocultar filas — cambia qué materiales trae `bi.v_posicion`.
 */
export function Filtros() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [q, setQ] = useState(searchParams.get('q') ?? '')

  useEffect(() => {
    const t = setTimeout(() => aplicar('q', q.trim() || null), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function aplicar(clave: string, valor: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (valor) params.set(clave, valor)
    else params.delete(clave)
    router.push(`${pathname}?${params.toString()}`)
  }

  const generoActual = searchParams.get('genero') ?? TODOS

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-64">
        <label className="text-ink-subtle mb-1 block text-xs">Buscar modelo o material</label>
        <input
          type="text"
          placeholder="jasper, 1031166…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border-line bg-surface text-ink placeholder:text-ink-muted focus:border-interactive focus:ring-interactive/30 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2"
        />
      </div>
      <div className="w-40">
        <label className="text-ink-subtle mb-1 block text-xs">Género</label>
        <select
          value={generoActual}
          onChange={(e) => aplicar('genero', e.target.value === TODOS ? null : e.target.value)}
          className="border-line bg-surface text-ink focus:border-interactive focus:ring-interactive/30 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2"
        >
          <option value={TODOS}>Todos</option>
          {GENEROS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
