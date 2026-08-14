import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ArchiveBox, Photo, TriangleDownMini, TriangleRightMini } from '@medusajs/icons'
import { Heading, Input, Select, Switch, Text, Tooltip } from '@medusajs/ui'
import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { num, pares } from '../../components/posicion'
import { sdk } from '../../lib/sdk'

/**
 * Posición de inventario por producto.
 *
 * Existe porque la lista nativa de Medusa tiene el grano equivocado para esta
 * operación: una fila por talla, titulada con la talla ("M 7") y sin decir de
 * qué producto es. Sus cuatro columnas están fijas en código y nunca pintan la
 * foto, así que esto no se podía resolver con un widget.
 *
 * Decisiones de interfaz (CLAUDE.md §4.5):
 *  - El grano es el material (modelo + color), que es como el negocio piensa
 *    el surtido. Las tallas se abren dentro.
 *  - Color con significado, el mismo de components/posicion.tsx: verde lo
 *    recibido, ámbar lo que navega, gris lo que aún es de la marca.
 *  - Densidad alta y números tabulares: es una pantalla de comparar cifras.
 */

/** Radix prohíbe value="" en un Select.Item, así que el "todos" va con marca. */
const TODOS = '__todos__'

type Talla = {
  sku: string
  talla: string
  propio: number
  reservado: number
  transito: number
  proveedor: number
}

type MaterialFila = {
  material: string
  producto_id: string | null
  foto: string | null
  descripcion: string
  modelo: string
  color: string
  genero: string
  categoria: string
  escala: string
  propio: number
  reservado: number
  vendible: number
  transito: number
  proveedor: number
  tallas_con_stock: number
  tallas_total: number
  tallas: Talla[]
}

type Respuesta = {
  operacion: string
  resumen: {
    materiales: number
    sin_stock_propio: number
    propio: number
    reservado: number
    transito: number
    proveedor: number
  }
  generos: string[]
  categorias: string[]
  materiales: MaterialFila[]
}

// --- Piezas ----------------------------------------------------------------
// Definidas a nivel de módulo, nunca dentro del componente de página: si se
// declaran dentro, React las trata como un tipo nuevo en cada render y
// remonta el subárbol, con lo que los campos pierden el foco al teclear.

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
  <div className="bg-ui-bg-subtle rounded-lg px-4 py-3">
    <div className="text-ui-fg-muted mb-1 text-xs">{etiqueta}</div>
    <div className={`text-2xl font-semibold ${num} ${tono}`}>{pares(valor)}</div>
    {nota && <div className="text-ui-fg-muted mt-0.5 text-xs">{nota}</div>}
  </div>
)

const Miniatura = ({ src, alt }: { src: string | null; alt: string }) =>
  src ? (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="border-ui-border-base bg-ui-bg-base h-10 w-10 shrink-0 rounded border object-cover"
    />
  ) : (
    <div className="border-ui-border-base bg-ui-bg-subtle text-ui-fg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded border">
      <Photo />
    </div>
  )

/** Celda numérica: en cero se apaga para que la vista no grite por nada. */
const Cifra = ({ valor, tono }: { valor: number; tono: string }) => (
  <td
    className={`px-3 py-2 text-right ${num} ${
      valor > 0 ? tono : 'text-ui-fg-muted'
    }`}
  >
    {pares(valor)}
  </td>
)

const DesgloseTallas = ({ tallas }: { tallas: Talla[] }) => (
  <div className="bg-ui-bg-subtle/50 px-3 py-3">
    <div className="flex flex-wrap gap-1.5">
      {tallas.map((t) => {
        const hay = t.propio > 0
        const viene = t.transito > 0
        return (
          <Tooltip
            key={t.sku}
            content={
              `${t.sku}\nBodega ${t.propio} · reservado ${t.reservado}\n` +
              `Tránsito ${t.transito} · marca ${t.proveedor}`
            }
          >
            <div
              className={`min-w-16 rounded border px-2 py-1 text-center ${
                hay
                  ? 'border-ui-tag-green-border bg-ui-tag-green-bg'
                  : viene
                    ? 'border-ui-tag-orange-border bg-ui-tag-orange-bg'
                    : 'border-ui-border-base bg-ui-bg-base'
              }`}
            >
              <div className={`text-ui-fg-subtle text-xs ${num}`}>{t.talla}</div>
              <div
                className={`text-sm font-medium ${num} ${
                  hay
                    ? 'text-ui-tag-green-text'
                    : viene
                      ? 'text-ui-tag-orange-text'
                      : 'text-ui-fg-muted'
                }`}
              >
                {hay ? t.propio : viene ? `+${t.transito}` : '0'}
              </div>
            </div>
          </Tooltip>
        )
      })}
    </div>
    <Text size="xsmall" className="text-ui-fg-muted mt-2">
      El número es lo que hay en bodega. En ámbar, lo que viene en camino.
      Pasa el cursor para el detalle completo.
    </Text>
  </div>
)

// --- Página ----------------------------------------------------------------

const InventarioPage = () => {
  const [q, setQ] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [genero, setGenero] = useState(TODOS)
  const [categoria, setCategoria] = useState(TODOS)
  const [conStock, setConStock] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)

  const [data, setData] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Se espera a que el usuario deje de teclear antes de consultar: sin esto
  // cada letra dispara una consulta sobre 3.064 variantes.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError(null)

    const query: Record<string, string> = { operacion: 'CO' }
    if (busqueda) query.q = busqueda
    if (genero !== TODOS) query.genero = genero
    if (categoria !== TODOS) query.categoria = categoria
    if (conStock) query.con_stock = 'true'

    sdk.client
      .fetch<Respuesta>('/admin/inventario', { query })
      .then((d) => {
        if (vigente) setData(d)
      })
      .catch((e: unknown) => {
        if (vigente) {
          setError(e instanceof Error ? e.message : 'No se pudo consultar')
        }
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })

    return () => {
      vigente = false
    }
  }, [busqueda, genero, categoria, conStock])

  const materiales = data?.materiales ?? []
  const r = data?.resumen

  return (
    <div className="flex flex-col gap-y-3">
      <div className="border-ui-border-base bg-ui-bg-base rounded-lg border px-6 py-4">
        <Heading level="h1">Inventario</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Posición por producto: lo que está en bodega, lo que viene navegando y
          lo que sigue disponible en la marca.
        </Text>
      </div>

      {/* --- Tarjetas de resumen --- */}
      {r && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Tarjeta
            etiqueta="En bodega"
            valor={r.propio}
            tono="text-ui-tag-green-text"
            nota={r.reservado > 0 ? `${pares(r.reservado)} reservados` : undefined}
          />
          <Tarjeta
            etiqueta="En tránsito"
            valor={r.transito}
            tono="text-ui-tag-orange-text"
            nota="despachado, sin recibir"
          />
          <Tarjeta
            etiqueta="Por pedir en la marca"
            valor={r.proveedor}
            tono="text-ui-fg-base"
            nota="disponible en KEEN"
          />
          <Tarjeta
            etiqueta="Productos"
            valor={r.materiales}
            tono="text-ui-fg-base"
            nota="modelo + color"
          />
          <Tarjeta
            etiqueta="Sin un par propio"
            valor={r.sin_stock_propio}
            tono={
              r.sin_stock_propio > 0 ? 'text-ui-tag-red-text' : 'text-ui-fg-muted'
            }
            nota={
              r.materiales > 0
                ? `${Math.round((100 * r.sin_stock_propio) / r.materiales)}% del catálogo`
                : undefined
            }
          />
        </div>
      )}

      {/* --- Filtros --- */}
      <div className="border-ui-border-base bg-ui-bg-base flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
        <Input
          placeholder="Buscar modelo, color o material…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64"
        />

        <Select value={genero} onValueChange={setGenero}>
          <Select.Trigger className="w-40">
            <Select.Value placeholder="Género" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={TODOS}>Todos los géneros</Select.Item>
            {(data?.generos ?? []).map((g) => (
              <Select.Item key={g} value={g}>
                {g}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        <Select value={categoria} onValueChange={setCategoria}>
          <Select.Trigger className="w-52">
            <Select.Value placeholder="Categoría" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={TODOS}>Todas las categorías</Select.Item>
            {(data?.categorias ?? []).map((c) => (
              <Select.Item key={c} value={c}>
                {c}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>

        <div className="flex items-center gap-x-2">
          <Switch
            id="solo-con-existencia"
            checked={conStock}
            onCheckedChange={setConStock}
          />
          <label
            htmlFor="solo-con-existencia"
            className="text-ui-fg-subtle cursor-pointer text-sm"
          >
            Solo con existencia
          </label>
        </div>

        {cargando && (
          <Text size="small" className="text-ui-fg-muted ml-auto">
            Consultando…
          </Text>
        )}
      </div>

      {/* --- Tabla --- */}
      {error ? (
        <div className="border-ui-border-error bg-ui-bg-base rounded-lg border px-6 py-10 text-center">
          <Text className="text-ui-fg-error">
            No se pudo cargar el inventario: {error}
          </Text>
        </div>
      ) : cargando && !data ? (
        <div className="border-ui-border-base bg-ui-bg-base rounded-lg border p-4">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="bg-ui-bg-subtle mb-2 h-12 animate-pulse rounded"
            />
          ))}
        </div>
      ) : materiales.length === 0 ? (
        <div className="border-ui-border-base bg-ui-bg-base rounded-lg border px-6 py-12 text-center">
          <Text className="text-ui-fg-subtle">
            Ningún producto con estos filtros.
          </Text>
          {conStock && (
            <Text size="small" className="text-ui-fg-muted mt-1">
              Tienes activo «solo con existencia»: prueba a quitarlo para ver lo
              que está en tránsito o disponible en la marca.
            </Text>
          )}
        </div>
      ) : (
        <div className="border-ui-border-base bg-ui-bg-base overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-ui-bg-subtle text-ui-fg-subtle text-xs">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="min-w-72 px-3 py-2 font-medium">Producto</th>
                <th className="w-24 px-3 py-2 font-medium">Género</th>
                <th className={`w-24 px-3 py-2 text-right font-medium ${num}`}>
                  Bodega
                </th>
                <th className={`w-24 px-3 py-2 text-right font-medium ${num}`}>
                  Tránsito
                </th>
                <th className={`w-28 px-3 py-2 text-right font-medium ${num}`}>
                  Marca
                </th>
                <th className={`w-24 px-3 py-2 text-right font-medium ${num}`}>
                  Tallas
                </th>
              </tr>
            </thead>
            <tbody className="divide-ui-border-base divide-y">
              {materiales.map((m) => {
                const expandido = abierto === m.material
                return (
                  <Fragment key={m.material}>
                  <tr
                    className="hover:bg-ui-bg-base-hover cursor-pointer"
                    onClick={() =>
                      setAbierto(expandido ? null : m.material)
                    }
                  >
                    <td className="text-ui-fg-muted px-2 py-2">
                      {expandido ? <TriangleDownMini /> : <TriangleRightMini />}
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex items-center gap-x-3">
                        <Miniatura src={m.foto} alt={m.descripcion} />
                        <div className="min-w-0">
                          {/* El enlace no debe abrir/cerrar la fila */}
                          {m.producto_id ? (
                            <Link
                              to={`/products/${m.producto_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-ui-fg-base hover:text-ui-fg-interactive font-medium"
                            >
                              {m.modelo} · {m.color}
                            </Link>
                          ) : (
                            <span className="text-ui-fg-base font-medium">
                              {m.modelo} · {m.color}
                            </span>
                          )}
                          <div className={`text-ui-fg-muted text-xs ${num}`}>
                            {m.material} · {m.categoria}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="text-ui-fg-subtle px-3 py-2 text-xs">
                      {m.genero}
                    </td>

                    <Cifra valor={m.propio} tono="text-ui-tag-green-text" />
                    <Cifra valor={m.transito} tono="text-ui-tag-orange-text" />
                    <Cifra valor={m.proveedor} tono="text-ui-fg-subtle" />

                    <td
                      className={`px-3 py-2 text-right text-xs ${num} ${
                        m.tallas_con_stock > 0
                          ? 'text-ui-fg-subtle'
                          : 'text-ui-fg-muted'
                      }`}
                    >
                      {m.tallas_con_stock}/{m.tallas_total}
                    </td>
                  </tr>

                  {expandido && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <DesgloseTallas tallas={m.tallas} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Va anidada bajo la sección de inventario nativa, no como entrada suelta.
 *
 * Con el admin en español, la etiqueta nativa (`es.inventory.domain`) es
 * "Inventario": una entrada nuestra con ese mismo nombre daba dos ítems
 * idénticos de primer nivel, que no se lee como dos herramientas sino como un
 * error de la aplicación.
 *
 * Anidada se lee como lo que es — una sección con dos vistas del mismo
 * inventario: la nativa para ajustar existencias, esta para verlas cruzadas
 * con tránsito y disponibilidad de marca.
 */
export const config = defineRouteConfig({
  label: 'Posición',
  icon: ArchiveBox,
  nested: '/inventory',
})

export default InventarioPage
