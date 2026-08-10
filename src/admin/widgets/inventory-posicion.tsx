import { defineWidgetConfig } from '@medusajs/admin-sdk'
import { Heading, Text } from '@medusajs/ui'
import { useEffect, useState } from 'react'

import { PosicionBloque, num, pares } from '../components/posicion'
import { sdk } from '../lib/sdk'

/**
 * Posición completa de un SKU en la ficha de inventario.
 *
 * La sección "Locations" de Medusa solo muestra existencias en bodegas
 * físicas, y en esta operación eso es la punta del iceberg: hay 278 pares en
 * bodega contra más de 10.000 navegando. Sin este bloque, la ficha da a
 * entender que no hay mercancía cuando lo que pasa es que aún no llegó.
 *
 * Se monta en `inventory_item.details.after`, que es zona oficial: el
 * LayoutComposer del dashboard le pasa el `inventory_item` en `data`.
 */

type Fila = {
  talla_label: string
  propio: number
  transito: number
  proveedor: number
}

type Respuesta = {
  encontrado: boolean
  sku: string
  talla?: Fila & { material: string; modelo: string; color: string }
  material?: {
    material: string
    modelo: string
    color: string
    genero: string
    propio: number
    transito: number
    proveedor: number
  }
  tallas?: Fila[]
}

type Props = { data: { id: string; sku?: string | null } }

const Marco = ({ children }: { children: React.ReactNode }) => (
  <div className="divide-ui-border-base border-ui-border-base bg-ui-bg-base divide-y rounded-lg border">
    <div className="px-6 py-4">
      <Heading level="h2">Posición de inventario</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Bodega, tránsito y disponibilidad en la marca
      </Text>
    </div>
    {children}
  </div>
)

const InventoryPosicion = ({ data }: Props) => {
  const sku = data?.sku ?? null

  const [resp, setResp] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!sku) {
      setCargando(false)
      return
    }

    let vigente = true
    setCargando(true)
    setError(null)

    sdk.client
      .fetch<Respuesta>('/admin/posicion', { query: { sku } })
      .then((d) => {
        if (vigente) setResp(d)
      })
      .catch((e: unknown) => {
        if (vigente) {
          setError(e instanceof Error ? e.message : 'No se pudo consultar')
        }
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })

    // Evita pintar la respuesta de un SKU que ya no se está viendo.
    return () => {
      vigente = false
    }
  }, [sku])

  if (!sku) {
    return (
      <Marco>
        <div className="px-6 py-6">
          <Text size="small" className="text-ui-fg-muted">
            Este artículo no tiene SKU, así que no se puede cruzar con el
            maestro.
          </Text>
        </div>
      </Marco>
    )
  }

  if (cargando) {
    return (
      <Marco>
        <div className="px-6 py-6">
          <div className="bg-ui-bg-subtle h-16 animate-pulse rounded-lg" />
        </div>
      </Marco>
    )
  }

  if (error) {
    return (
      <Marco>
        <div className="px-6 py-6">
          <Text size="small" className="text-ui-fg-error">
            No se pudo consultar la posición: {error}
          </Text>
        </div>
      </Marco>
    )
  }

  if (!resp?.encontrado || !resp.talla || !resp.material) {
    return (
      <Marco>
        <div className="px-6 py-6">
          <Text size="small" className="text-ui-fg-muted">
            El SKU <span className={num}>{sku}</span> no está en el maestro de
            inventario. Solo se ve lo que registre Medusa arriba.
          </Text>
        </div>
      </Marco>
    )
  }

  const { talla, material, tallas = [] } = resp

  return (
    <Marco>
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle mb-3">
          Esta talla ({talla.talla_label})
        </Text>
        <PosicionBloque
          propio={talla.propio}
          transito={talla.transito}
          proveedor={talla.proveedor}
        />
      </div>

      <div className="px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle mb-3">
          {material.modelo} · {material.color} — todas las tallas
        </Text>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ui-fg-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Talla</th>
                <th className={`py-1 pr-3 text-right font-medium ${num}`}>
                  Bodega
                </th>
                <th className={`py-1 pr-3 text-right font-medium ${num}`}>
                  Tránsito
                </th>
                <th className={`py-1 text-right font-medium ${num}`}>Marca</th>
              </tr>
            </thead>
            <tbody className="divide-ui-border-base divide-y">
              {tallas.map((f) => {
                const actual = f.talla_label === talla.talla_label
                return (
                  <tr
                    key={f.talla_label}
                    className={actual ? 'bg-ui-bg-highlight' : undefined}
                  >
                    <td
                      className={`py-1 pr-3 ${num} ${
                        actual ? 'text-ui-fg-base font-medium' : 'text-ui-fg-subtle'
                      }`}
                    >
                      {f.talla_label}
                    </td>
                    <td
                      className={`py-1 pr-3 text-right ${num} ${
                        f.propio > 0 ? 'text-ui-tag-green-text' : 'text-ui-fg-muted'
                      }`}
                    >
                      {pares(f.propio)}
                    </td>
                    <td
                      className={`py-1 pr-3 text-right ${num} ${
                        f.transito > 0
                          ? 'text-ui-tag-orange-text'
                          : 'text-ui-fg-muted'
                      }`}
                    >
                      {pares(f.transito)}
                    </td>
                    <td
                      className={`py-1 text-right ${num} ${
                        f.proveedor > 0 ? 'text-ui-fg-subtle' : 'text-ui-fg-muted'
                      }`}
                    >
                      {pares(f.proveedor)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-ui-border-base border-t">
              <tr className="text-ui-fg-base font-medium">
                <td className="py-1.5 pr-3">Total</td>
                <td className={`py-1.5 pr-3 text-right ${num}`}>
                  {pares(material.propio)}
                </td>
                <td className={`py-1.5 pr-3 text-right ${num}`}>
                  {pares(material.transito)}
                </td>
                <td className={`py-1.5 text-right ${num}`}>
                  {pares(material.proveedor)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Marco>
  )
}

export const config = defineWidgetConfig({
  zone: 'inventory_item.details.after',
})

export default InventoryPosicion
