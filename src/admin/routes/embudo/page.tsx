import { defineRouteConfig } from '@medusajs/admin-sdk'
import { Funnel } from '@medusajs/icons'
import { Badge, Button, Heading, Text, Tooltip } from '@medusajs/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Embudo de ventas y despacho.
 *
 * Tablero por etapas. La etapa no se guarda en ninguna parte: se deriva de los
 * campos nativos de Medusa (borrador, reservas, cantidades alistadas,
 * despachadas y entregadas), así que refleja la realidad aunque alguien opere
 * desde las pantallas estándar del admin.
 *
 * El dato que manda no es cuántos pedidos hay en cada columna, sino cuáles
 * llevan días sin moverse: eso es lo accionable (CLAUDE.md §4.5, estado
 * siempre visible).
 */

type Pedido = {
  order_id: string
  display_id: number
  cliente: string
  currency_code: string
  etapa: string
  etapa_orden: number
  unidades: number
  valor: number
  reservas: number
  alistadas: number
  despachadas: number
  entregadas: number
  dias_sin_avanzar: number
}

type Resumen = {
  etapa: string
  etapa_orden: number
  pedidos: number
  unidades: number
  valor: number
  dias_max_sin_avanzar: number
  atascados: number
}

const num = 'tabular-nums'
const DIAS_ATASCADO = 7

/** Orden canónico del embudo. Las etapas sin pedidos también se muestran: una
 *  columna vacía informa tanto como una llena. */
const ETAPAS = [
  { key: 'COTIZACION', label: 'Cotización' },
  { key: 'PEDIDO', label: 'Pedido' },
  { key: 'RESERVADO', label: 'Reservado' },
  { key: 'EMPACADO', label: 'Empacado' },
  { key: 'DESPACHO PARCIAL', label: 'Despacho parcial' },
  { key: 'DESPACHADO', label: 'Despachado' },
  { key: 'ENTREGADO', label: 'Entregado' },
]

const dinero = (v: number, moneda: string) =>
  `${v.toLocaleString('es-CO', { maximumFractionDigits: 0 })} ${moneda.toUpperCase()}`

const EmbudoPage = () => {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [resumen, setResumen] = useState<Resumen[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch('/admin/embudo', { credentials: 'include' })
      if (!r.ok) throw new Error(`El servidor respondió ${r.status}`)
      const d = await r.json()
      setPedidos(d.pedidos)
      setResumen(d.resumen)
    } catch (e: any) {
      setError(e.message ?? 'No se pudo cargar el embudo')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const porEtapa = useMemo(() => {
    const m = new Map<string, Pedido[]>()
    ETAPAS.forEach((e) => m.set(e.key, []))
    pedidos.forEach((p) => {
      if (!m.has(p.etapa)) m.set(p.etapa, [])
      m.get(p.etapa)!.push(p)
    })
    return m
  }, [pedidos])

  const resumenPorEtapa = useMemo(() => {
    const m = new Map<string, Resumen>()
    resumen.forEach((r) => m.set(r.etapa, r))
    return m
  }, [resumen])

  const totales = useMemo(() => {
    const activos = pedidos.filter(
      (p) => p.etapa !== 'CANCELADO' && p.etapa !== 'ENTREGADO'
    )
    return {
      abiertos: activos.length,
      unidades: activos.reduce((a, p) => a + p.unidades, 0),
      valor: activos.reduce((a, p) => a + p.valor, 0),
      atascados: activos.filter((p) => p.dias_sin_avanzar > DIAS_ATASCADO).length,
    }
  }, [pedidos])

  const cancelados = pedidos.filter((p) => p.etapa === 'CANCELADO')

  const Marco = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-col gap-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Heading level="h1">Embudo</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            De cotización a entrega. La etapa se deduce del estado real del
            pedido, no de una marca aparte.
          </Text>
        </div>
        <div className="flex items-center gap-x-5">
          <div className={`text-right ${num}`}>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Abiertos
            </Text>
            <Text weight="plus">{totales.abiertos}</Text>
          </div>
          <div className={`text-right ${num}`}>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Unidades
            </Text>
            <Text weight="plus">{totales.unidades}</Text>
          </div>
          <div className={`text-right ${num}`}>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Valor
            </Text>
            <Text weight="plus">
              {totales.valor.toLocaleString('es-CO', {
                maximumFractionDigits: 0,
              })}
            </Text>
          </div>
          {totales.atascados > 0 && (
            <Tooltip
              content={`Sin avanzar en más de ${DIAS_ATASCADO} días`}
            >
              <Badge color="red" size="small">
                {totales.atascados} atascados
              </Badge>
            </Tooltip>
          )}
          <Button size="small" variant="secondary" onClick={cargar}>
            Actualizar
          </Button>
        </div>
      </div>
      {children}
    </div>
  )

  if (cargando && pedidos.length === 0) {
    return (
      <Marco>
        <div className="bg-ui-bg-base border-ui-border-base rounded-lg border p-8">
          <Text className="text-ui-fg-subtle">Cargando embudo…</Text>
        </div>
      </Marco>
    )
  }

  if (error) {
    return (
      <Marco>
        <div className="bg-ui-bg-base border-ui-border-error rounded-lg border p-8">
          <Text className="text-ui-fg-error mb-3">{error}</Text>
          <Button size="small" variant="secondary" onClick={cargar}>
            Reintentar
          </Button>
        </div>
      </Marco>
    )
  }

  if (pedidos.length === 0) {
    return (
      <Marco>
        <div className="bg-ui-bg-base border-ui-border-base rounded-lg border p-10 text-center">
          <Text className="text-ui-fg-subtle">
            Todavía no hay pedidos ni cotizaciones.
          </Text>
          <Text size="small" className="text-ui-fg-muted mt-1">
            Cuando se cree el primero aparecerá aquí, en la etapa que le
            corresponda.
          </Text>
        </div>
      </Marco>
    )
  }

  return (
    <Marco>
      <div className="flex gap-x-3 overflow-x-auto pb-2">
        {ETAPAS.map((etapa) => {
          const lista = porEtapa.get(etapa.key) ?? []
          const res = resumenPorEtapa.get(etapa.key)
          return (
            <div
              key={etapa.key}
              className="border-ui-border-base bg-ui-bg-subtle flex w-64 shrink-0 flex-col rounded-lg border"
            >
              <div className="border-ui-border-base flex items-baseline justify-between border-b px-3 py-2">
                <Text size="small" weight="plus">
                  {etapa.label}
                </Text>
                <span className={`text-ui-fg-subtle text-xs ${num}`}>
                  {lista.length}
                </span>
              </div>

              {res && lista.length > 0 && (
                <div
                  className={`text-ui-fg-subtle border-ui-border-base border-b px-3 py-1.5 text-xs ${num}`}
                >
                  {res.unidades} u ·{' '}
                  {res.valor.toLocaleString('es-CO', {
                    maximumFractionDigits: 0,
                  })}
                </div>
              )}

              <div className="flex flex-col gap-y-2 p-2">
                {lista.length === 0 && (
                  <Text size="xsmall" className="text-ui-fg-muted px-1 py-3">
                    Sin pedidos
                  </Text>
                )}
                {lista.map((p) => {
                  const atascado = p.dias_sin_avanzar > DIAS_ATASCADO
                  return (
                    <a
                      key={p.order_id}
                      href={`/app/orders/${p.order_id}`}
                      className={`bg-ui-bg-base block rounded-md border p-2 transition-colors ${
                        atascado
                          ? 'border-ui-border-error'
                          : 'border-ui-border-base hover:border-ui-border-interactive'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-x-2">
                        <span className={`text-ui-fg-base text-xs ${num}`}>
                          #{p.display_id}
                        </span>
                        <span
                          className={`text-xs ${num} ${
                            atascado ? 'text-ui-fg-error' : 'text-ui-fg-muted'
                          }`}
                        >
                          {p.dias_sin_avanzar}d
                        </span>
                      </div>
                      <div className="text-ui-fg-subtle truncate text-xs">
                        {p.cliente}
                      </div>
                      <div
                        className={`text-ui-fg-muted mt-1 flex justify-between text-xs ${num}`}
                      >
                        <span>{p.unidades} u</span>
                        <span>{dinero(p.valor, p.currency_code)}</span>
                      </div>
                      {p.despachadas > 0 && p.despachadas < p.unidades && (
                        <div className={`text-ui-fg-muted mt-1 text-xs ${num}`}>
                          despachadas {p.despachadas}/{p.unidades}
                        </div>
                      )}
                    </a>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {cancelados.length > 0 && (
        <Text size="xsmall" className="text-ui-fg-muted">
          {cancelados.length} pedido(s) cancelado(s), fuera del tablero.
        </Text>
      )}

      <Text size="xsmall" className="text-ui-fg-muted">
        Los recuadros en rojo llevan más de {DIAS_ATASCADO} días sin avanzar ·
        clic en una tarjeta abre el pedido
      </Text>
    </Marco>
  )
}

export const config = defineRouteConfig({
  label: 'Embudo',
  icon: Funnel,
})

export default EmbudoPage
