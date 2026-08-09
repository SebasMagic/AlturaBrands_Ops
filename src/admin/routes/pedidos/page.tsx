import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ShoppingCart } from '@medusajs/icons'
import {
  Badge,
  Button,
  Heading,
  Input,
  Select,
  Text,
  Tooltip,
  toast,
} from '@medusajs/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { sdk } from '../../lib/sdk'
// Se importa desde aquí porque las extensiones del admin no tienen un punto de
// entrada global: Vite empaqueta este CSS con el resto y acaba aplicándose a
// todo el admin, incluida la pantalla de acceso. Ver el aviso del archivo.
import '../../styles/branding.css'

/**
 * Grilla de armado de pedido a marca.
 *
 * El comprador teclea BULTOS y las tallas se calculan solas desde la curva.
 * Puede editar una celda suelta, y entonces la línea queda marcada como
 * ajustada — se guarda la curva más el ajuste, nunca una curva inventada.
 *
 * Decisiones de interfaz (CLAUDE.md §4.5):
 *  - Densidad alta: es una pantalla de 8 horas, no una landing.
 *  - Teclado primero: Enter baja al siguiente bulto sin tocar el mouse.
 *  - Color con significado: rojo solo cuando se pide más de lo disponible.
 *  - Números tabulares en toda columna de cantidades.
 */

type TallaInfo = {
  sku: string
  disponible: number
  propio: number
  transito: number
}

type Material = {
  material: string
  descripcion: string
  modelo: string
  genero: string
  categoria: string
  color: string
  escala: string
  msrp_usd: number | null
  costo_usd_cents: number | null
  disponible_total: number
  propio_total: number
  transito_total: number
  tallas: Record<string, TallaInfo>
}

type Curva = {
  code: string
  name: string
  scale: string
  pairs_per_pack: number
  is_default: boolean
  entries: { size_label: string; size_value: number; ratio: number }[]
}

type Respuesta = {
  operacion: string
  marca: string
  tallas: string[]
  curvas: Curva[]
  materiales: Material[]
}

/** Estado de una línea del pedido. */
type Linea = {
  packs: number
  curva: string
  /** Cantidades por talla. Solo presente si el usuario tocó alguna celda. */
  override?: Record<string, number>
}

const num = 'tabular-nums'

/**
 * Valor centinela para "sin filtro".
 *
 * El Select de @medusajs/ui está construido sobre Radix, que PROHÍBE que un
 * item tenga `value=""` y lanza una excepción al renderizar. Con cadena vacía
 * la pantalla entera moría con "An unexpected error occurred".
 */
const TODOS = '__todos__'

/** Cantidades de una línea: curva × bultos, con los ajustes aplicados encima. */
function cantidades(linea: Linea | undefined, curva: Curva | undefined) {
  if (!linea || linea.packs <= 0) return linea?.override ?? {}
  const base: Record<string, number> = {}
  curva?.entries.forEach((e) => {
    base[e.size_label] = e.ratio * linea.packs
  })
  return { ...base, ...(linea.override ?? {}) }
}

const PedidosPage = () => {
  const [data, setData] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lineas, setLineas] = useState<Record<string, Linea>>({})
  const [genero, setGenero] = useState<string>(TODOS)
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)

  const bultosRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const fileRef = useRef<HTMLInputElement | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const query: Record<string, string> = {}
      if (genero && genero !== TODOS) query.genero = genero
      if (busqueda.trim()) query.q = busqueda.trim()
      const d = await sdk.client.fetch<Respuesta>('/admin/pedidos/catalogo', {
        query,
      })
      setData(d)
    } catch (e: any) {
      setError(e.message ?? 'No se pudo cargar el catálogo')
    } finally {
      setCargando(false)
    }
  }, [genero, busqueda])

  useEffect(() => {
    const t = setTimeout(cargar, 250)
    return () => clearTimeout(t)
  }, [cargar])

  const curvasPorCodigo = useMemo(() => {
    const m = new Map<string, Curva>()
    data?.curvas.forEach((c) => m.set(c.code, c))
    return m
  }, [data])

  /** Curva sugerida: la marcada por defecto para la escala del material. */
  const curvaSugerida = useCallback(
    (escala: string) =>
      data?.curvas.find((c) => c.scale === escala && c.is_default)?.code ??
      data?.curvas.find((c) => c.scale === escala)?.code ??
      '',
    [data]
  )

  const setPacks = (mat: Material, packs: number) => {
    setLineas((prev) => {
      const actual = prev[mat.material]
      const curva = actual?.curva || curvaSugerida(mat.escala)
      if (packs <= 0 && !actual?.override) {
        const { [mat.material]: _, ...resto } = prev
        return resto
      }
      // Cambiar bultos descarta los ajustes: si no, quedaría una mezcla
      // silenciosa entre lo recalculado y lo tecleado a mano.
      return { ...prev, [mat.material]: { packs, curva } }
    })
  }

  const setCurva = (mat: Material, code: string) => {
    setLineas((prev) => ({
      ...prev,
      [mat.material]: { packs: prev[mat.material]?.packs ?? 0, curva: code },
    }))
  }

  const setCelda = (mat: Material, talla: string, valor: number) => {
    setLineas((prev) => {
      const actual = prev[mat.material] ?? {
        packs: 0,
        curva: curvaSugerida(mat.escala),
      }
      const calculadas = cantidades(actual, curvasPorCodigo.get(actual.curva))
      const override = { ...(actual.override ?? {}) }
      if (valor === (calculadas[talla] ?? 0)) delete override[talla]
      else override[talla] = valor
      const siguiente: Linea = { ...actual, override }
      if (!Object.keys(override).length) delete siguiente.override
      return { ...prev, [mat.material]: siguiente }
    })
  }

  const materiales = data?.materiales ?? []
  const tallas = data?.tallas ?? []

  const resumen = useMemo(() => {
    let items = 0
    let packs = 0
    let pares = 0
    let costo = 0
    let excesos = 0
    for (const mat of materiales) {
      const linea = lineas[mat.material]
      if (!linea) continue
      const qty = cantidades(linea, curvasPorCodigo.get(linea.curva))
      const total = Object.values(qty).reduce((a, b) => a + b, 0)
      if (total <= 0) continue
      items++
      packs += linea.packs
      pares += total
      costo += (mat.costo_usd_cents ?? 0) * total
      for (const [talla, q] of Object.entries(qty)) {
        if (q > (mat.tallas[talla]?.disponible ?? 0)) excesos++
      }
    }
    return { items, packs, pares, costo, excesos }
  }, [lineas, materiales, curvasPorCodigo])

  const guardar = async () => {
    setGuardando(true)
    try {
      const items = materiales
        .filter((m) => lineas[m.material])
        .map((m) => {
          const linea = lineas[m.material]
          const qty = cantidades(linea, curvasPorCodigo.get(linea.curva))
          const sizes = Object.entries(qty)
            .filter(([, q]) => q > 0)
            .map(([talla, q]) => ({
              sku: m.tallas[talla]?.sku ?? `${m.material}-${m.escala}${talla}`,
              size_label: talla,
              size_value: parseFloat(talla),
              quantity_requested: q,
            }))
          return {
            material_code: m.material,
            description: m.descripcion,
            size_curve_code: linea.curva,
            packs: linea.packs,
            is_adjusted: !!linea.override,
            adjustment_note: linea.override
              ? `Ajustadas a mano: ${Object.keys(linea.override).join(', ')}`
              : null,
            unit_cost_cents: m.costo_usd_cents,
            sizes,
          }
        })
        .filter((i) => i.sizes.length > 0)

      const creado = await sdk.client.fetch<{ code: string }>('/admin/pedidos', {
        method: 'POST',
        body: {
          operation_code: data?.operacion,
          brand_code: data?.marca,
          currency_code: 'usd',
          items,
        },
      })
      toast.success(`Pedido ${creado.code} creado`, {
        description: `${resumen.items} materiales · ${resumen.pares} pares`,
      })
      setLineas({})
    } catch (e: any) {
      toast.error('No se pudo crear el pedido', { description: e.message })
    } finally {
      setGuardando(false)
    }
  }

  /**
   * Subida de una hoja de pedido armada fuera del sistema.
   *
   * Va en dos tiempos a propósito: primero una vista previa que muestra qué
   * entendió el sistema y qué avisos encontró, y solo si el usuario confirma
   * se crea el pedido. Importar a ciegas un archivo de 80 líneas y descubrir
   * después que la mitad se interpretó mal es peor que no importar.
   */
  const subirArchivo = async (file: File) => {
    setSubiendo(true)
    try {
      const cuerpo = new FormData()
      cuerpo.append('file', file)

      const datosPrevia = await sdk.client.fetch<any>('/admin/pedidos/importar', {
        method: 'POST',
        query: { dry_run: '1' },
        body: cuerpo,
      })

      const { resumen, avisos } = datosPrevia
      const detalle =
        `${resumen.items} materiales · ${resumen.packs} bultos · ` +
        `${resumen.pares} pares` +
        (avisos.length ? `\n${avisos.length} aviso(s):\n· ${avisos.slice(0, 5).join('\n· ')}` : '')

      if (!window.confirm(`Se leyó ${file.name}\n\n${detalle}\n\n¿Crear el pedido?`)) {
        toast.info('Importación cancelada')
        return
      }

      const cuerpo2 = new FormData()
      cuerpo2.append('file', file)
      const creado = await sdk.client.fetch<any>('/admin/pedidos/importar', {
        method: 'POST',
        body: cuerpo2,
      })

      toast.success(`Pedido ${creado.code} creado`, {
        description: `${creado.resumen.items} materiales · ${creado.resumen.pares} pares`,
      })
    } catch (e: any) {
      toast.error('No se pudo importar el archivo', { description: e.message })
    } finally {
      setSubiendo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // --- Estados de carga, error y vacío ------------------------------------
  /**
   * Función que devuelve JSX, NO un componente.
   *
   * Declarar un componente dentro de otro crea un tipo nuevo en cada render:
   * React desmonta y vuelve a montar todo el subárbol, y los campos pierden el
   * foco a cada tecla. En una grilla de captura eso la vuelve inusable.
   */
  const marco = (children: React.ReactNode) => (
    <div className="flex flex-col gap-y-4 p-6">
      <div className="flex items-baseline justify-between gap-x-4">
        <div>
          <Heading level="h1">Armar pedido</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Teclea bultos y las tallas se calculan con la curva. Enter baja al
            siguiente.
          </Text>
        </div>
      </div>
      {children}
    </div>
  )

  if (cargando && !data) {
    return marco(
      <>
        <div className="bg-ui-bg-base border-ui-border-base rounded-lg border p-8">
          <Text className="text-ui-fg-subtle">Cargando catálogo…</Text>
        </div>
      </>
    )
  }

  if (error) {
    return marco(
      <>
        <div className="bg-ui-bg-base border-ui-border-error rounded-lg border p-8">
          <Text className="text-ui-fg-error mb-3">{error}</Text>
          <Button size="small" variant="secondary" onClick={cargar}>
            Reintentar
          </Button>
        </div>
      </>
    )
  }

  return marco(
    <>
      {/* --- Filtros y resumen --- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">
            Buscar modelo o material
          </Text>
          <Input
            size="small"
            placeholder="jasper, 1031166…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Text size="xsmall" className="text-ui-fg-subtle mb-1">
            Género
          </Text>
          <Select size="small" value={genero} onValueChange={setGenero}>
            <Select.Trigger>
              <Select.Value placeholder="Todos" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={TODOS}>Todos</Select.Item>
              {['MEN', 'WOMEN', 'CHILDREN', 'YOUTH', 'TOTS'].map((g) => (
                <Select.Item key={g} value={g}>
                  {g}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-x-4">
          <div className={`text-right ${num}`}>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Materiales
            </Text>
            <Text weight="plus">{resumen.items}</Text>
          </div>
          <div className={`text-right ${num}`}>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Bultos
            </Text>
            <Text weight="plus">{resumen.packs}</Text>
          </div>
          <div className={`text-right ${num}`}>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Pares
            </Text>
            <Text weight="plus">{resumen.pares}</Text>
          </div>
          <div className={`text-right ${num}`}>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Costo USD
            </Text>
            <Text weight="plus">
              {(resumen.costo / 100).toLocaleString('es-CO', {
                maximumFractionDigits: 0,
              })}
            </Text>
          </div>
          {resumen.excesos > 0 && (
            <Tooltip content="Hay tallas donde se pide más de lo disponible en el proveedor">
              <Badge color="red" size="small">
                {resumen.excesos} sobre disponible
              </Badge>
            </Tooltip>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) subirArchivo(f)
            }}
          />
          <Tooltip content="Sube una hoja con el layout de pedido de la marca. Verás una vista previa antes de crear nada.">
            <Button
              size="small"
              variant="secondary"
              disabled={subiendo}
              isLoading={subiendo}
              onClick={() => fileRef.current?.click()}
            >
              Cargar archivo
            </Button>
          </Tooltip>
          <Button
            size="small"
            disabled={resumen.items === 0 || guardando}
            onClick={guardar}
            isLoading={guardando}
          >
            Crear pedido
          </Button>
        </div>
      </div>

      {/* --- Grilla --- */}
      {materiales.length === 0 ? (
        <div className="bg-ui-bg-base border-ui-border-base rounded-lg border p-8 text-center">
          <Text className="text-ui-fg-subtle">
            Ningún material con disponibilidad para estos filtros.
          </Text>
        </div>
      ) : (
        <div className="border-ui-border-base bg-ui-bg-base overflow-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="bg-ui-bg-subtle text-ui-fg-subtle sticky top-0 z-10">
              <tr>
                <th className="min-w-64 px-3 py-2 font-medium">Material</th>
                <th className="w-36 px-2 py-2 font-medium">Curva</th>
                <th className={`w-16 px-2 py-2 text-right font-medium ${num}`}>
                  Bultos
                </th>
                {tallas.map((t) => (
                  <th
                    key={t}
                    className={`w-14 px-1 py-2 text-center font-medium ${num}`}
                  >
                    {t}
                  </th>
                ))}
                <th className={`w-16 px-2 py-2 text-right font-medium ${num}`}>
                  Pares
                </th>
              </tr>
            </thead>
            <tbody className="divide-ui-border-base divide-y">
              {materiales.map((mat, idx) => {
                const linea = lineas[mat.material]
                const curvaCode = linea?.curva || curvaSugerida(mat.escala)
                const qty = cantidades(linea, curvasPorCodigo.get(curvaCode))
                const total = Object.values(qty).reduce((a, b) => a + b, 0)
                const activa = total > 0

                return (
                  <tr
                    key={mat.material}
                    className={
                      activa ? 'bg-ui-bg-highlight' : 'hover:bg-ui-bg-base-hover'
                    }
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-x-2">
                        <span className="text-ui-fg-base font-medium">
                          {mat.descripcion}
                        </span>
                        {linea?.override && (
                          <Tooltip
                            content={`Ajustado a mano: ${Object.keys(
                              linea.override
                            ).join(', ')}`}
                          >
                            <Badge color="orange" size="2xsmall">
                              ajustado
                            </Badge>
                          </Tooltip>
                        )}
                      </div>
                      <span className={`text-ui-fg-muted ${num}`}>
                        {mat.material} · {mat.categoria} · disp{' '}
                        {mat.disponible_total}
                      </span>
                    </td>

                    <td className="px-2 py-1.5">
                      <select
                        className="bg-ui-bg-field border-ui-border-base text-ui-fg-base w-full rounded border px-1 py-0.5 text-xs"
                        value={curvaCode}
                        onChange={(e) => setCurva(mat, e.target.value)}
                      >
                        {data?.curvas
                          .filter((c) => c.scale === mat.escala)
                          .map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code} ({c.pairs_per_pack})
                            </option>
                          ))}
                      </select>
                    </td>

                    <td className="px-2 py-1.5">
                      <input
                        ref={(el) => {
                          bultosRefs.current[mat.material] = el
                        }}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className={`bg-ui-bg-field border-ui-border-base text-ui-fg-base w-full rounded border px-1 py-0.5 text-right text-xs ${num}`}
                        value={linea?.packs || ''}
                        onChange={(e) =>
                          setPacks(mat, parseInt(e.target.value, 10) || 0)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            const siguiente = materiales[idx + 1]
                            if (siguiente) {
                              bultosRefs.current[siguiente.material]?.focus()
                              bultosRefs.current[siguiente.material]?.select()
                            }
                          }
                        }}
                      />
                    </td>

                    {tallas.map((t) => {
                      const info = mat.tallas[t]
                      const pedido = qty[t] ?? 0
                      const disponible = info?.disponible ?? 0
                      const excede = pedido > disponible
                      const ajustada = linea?.override?.[t] !== undefined

                      if (!info) {
                        return (
                          <td
                            key={t}
                            className="bg-ui-bg-subtle/40 px-1 py-1.5"
                            title="Este material no existe en esta talla"
                          />
                        )
                      }

                      return (
                        <td key={t} className="px-1 py-1.5">
                          <Tooltip
                            content={`Disponible ${disponible} · ${info.sku}`}
                          >
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              className={`w-full rounded border px-1 py-0.5 text-center text-xs ${num} ${
                                excede
                                  ? 'border-ui-border-error bg-ui-bg-base text-ui-fg-error'
                                  : ajustada
                                    ? 'border-ui-tag-orange-border bg-ui-bg-base'
                                    : 'bg-ui-bg-field border-ui-border-base text-ui-fg-base'
                              }`}
                              value={pedido || ''}
                              onChange={(e) =>
                                setCelda(
                                  mat,
                                  t,
                                  parseInt(e.target.value, 10) || 0
                                )
                              }
                            />
                          </Tooltip>
                        </td>
                      )
                    })}

                    <td
                      className={`px-2 py-1.5 text-right font-medium ${num} ${
                        activa ? 'text-ui-fg-base' : 'text-ui-fg-muted'
                      }`}
                    >
                      {total || ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Text size="xsmall" className="text-ui-fg-muted">
        {materiales.length} materiales con disponibilidad · las celdas en rojo
        piden más de lo que hay en el proveedor · las naranjas se editaron a
        mano
      </Text>
    </>
  )
}

export const config = defineRouteConfig({
  label: 'Armar pedido',
  icon: ShoppingCart,
})

export default PedidosPage
