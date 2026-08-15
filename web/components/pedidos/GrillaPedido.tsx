'use client'

import { useMemo, useRef, useState } from 'react'
import { crearPedidoAction } from '@/app/pedidos/actions'
import {
  cantidades,
  calcularResumenPedido,
  curvaSugerida,
  type Curva,
  type Linea,
  type MaterialPedido,
} from '@/lib/domain/pedidos'

const num = 'tabular-nums'

/** Los tres estados en una línea — mismo código de color que Inventario (CLAUDE.md §6/§8). */
function PosicionLinea({ propio, transito, proveedor }: { propio: number; transito: number; proveedor: number }) {
  const apagado = 'text-ink-muted'
  return (
    <span className={`${num} text-xs`}>
      <span className={propio > 0 ? 'text-stock-bodega' : apagado}>bodega {propio}</span>
      <span className={apagado}> · </span>
      <span className={transito > 0 ? 'text-stock-transito' : apagado}>tránsito {transito}</span>
      <span className={apagado}> · </span>
      <span className={proveedor > 0 ? 'text-stock-marca' : apagado}>marca {proveedor}</span>
    </span>
  )
}

export function GrillaPedido({
  operacion,
  marca,
  tallas,
  curvas,
  materiales,
}: {
  operacion: string
  marca: string
  tallas: string[]
  curvas: Curva[]
  materiales: MaterialPedido[]
}) {
  const [lineas, setLineas] = useState<Record<string, Linea>>({})
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; mensaje: string } | null>(null)

  const bultosRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const curvasPorCodigo = useMemo(() => new Map(curvas.map((c) => [c.code, c])), [curvas])

  const resumen = useMemo(
    () => calcularResumenPedido(materiales, lineas, curvasPorCodigo),
    [materiales, lineas, curvasPorCodigo]
  )

  const setPacks = (mat: MaterialPedido, packs: number) => {
    setLineas((prev) => {
      const actual = prev[mat.material]
      const curva = actual?.curva || curvaSugerida(curvas, mat.escala)
      if (packs <= 0 && !actual?.override) {
        const { [mat.material]: _omitida, ...resto } = prev
        return resto
      }
      // Cambiar bultos descarta los ajustes: si no, quedaría una mezcla
      // silenciosa entre lo recalculado y lo tecleado a mano.
      return { ...prev, [mat.material]: { packs, curva } }
    })
  }

  const setCurva = (mat: MaterialPedido, code: string) => {
    setLineas((prev) => ({
      ...prev,
      [mat.material]: { packs: prev[mat.material]?.packs ?? 0, curva: code },
    }))
  }

  const setCelda = (mat: MaterialPedido, talla: string, valor: number) => {
    setLineas((prev) => {
      const actual = prev[mat.material] ?? { packs: 0, curva: curvaSugerida(curvas, mat.escala) }
      const calculadas = cantidades(actual, curvasPorCodigo.get(actual.curva))
      const override = { ...(actual.override ?? {}) }
      if (valor === (calculadas[talla] ?? 0)) delete override[talla]
      else override[talla] = valor
      const siguiente: Linea = { ...actual, override }
      if (!Object.keys(override).length) delete siguiente.override
      return { ...prev, [mat.material]: siguiente }
    })
  }

  const guardar = async () => {
    setGuardando(true)
    setAviso(null)
    const resultado = await crearPedidoAction(operacion, marca, materiales, curvas, lineas)
    setGuardando(false)
    if (resultado.ok) {
      setAviso({
        tipo: 'ok',
        mensaje: `Pedido ${resultado.code} creado — ${resultado.items} materiales · ${resultado.pares} pares`,
      })
      setLineas({})
    } else {
      setAviso({ tipo: 'error', mensaje: resultado.error })
    }
  }

  if (materiales.length === 0) {
    return (
      <div className="border-line bg-surface rounded-lg border p-8 text-center">
        <p className="text-ink-subtle text-sm">Ningún material con disponibilidad para estos filtros.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex flex-wrap items-center gap-x-4">
        <div className={`text-right ${num}`}>
          <div className="text-ink-subtle text-xs">Materiales</div>
          <div className="text-ink font-medium">{resumen.items}</div>
        </div>
        <div className={`text-right ${num}`}>
          <div className="text-ink-subtle text-xs">Bultos</div>
          <div className="text-ink font-medium">{resumen.packs}</div>
        </div>
        <div className={`text-right ${num}`}>
          <div className="text-ink-subtle text-xs">Pares</div>
          <div className="text-ink font-medium">{resumen.pares}</div>
        </div>
        <div className={`text-right ${num}`}>
          <div className="text-ink-subtle text-xs">Costo USD</div>
          <div className="text-ink font-medium">
            {(resumen.costoUsdCents / 100).toLocaleString('es-CO', { maximumFractionDigits: 0 })}
          </div>
        </div>
        {resumen.excesos > 0 && (
          <span
            className="border-danger/30 bg-danger-bg text-danger rounded-full border px-2.5 py-1 text-xs font-medium"
            title="Hay tallas donde se pide más de lo disponible en el proveedor"
          >
            {resumen.excesos} sobre disponible
          </span>
        )}

        <button
          disabled={resumen.items === 0 || guardando}
          onClick={guardar}
          className="bg-interactive disabled:bg-ink-muted ml-auto rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed"
        >
          {guardando ? 'Creando…' : 'Crear pedido'}
        </button>
      </div>

      {aviso && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            aviso.tipo === 'ok'
              ? 'border-stock-bodega/30 bg-stock-bodega/10 text-stock-bodega'
              : 'border-danger/30 bg-danger-bg text-danger'
          }`}
        >
          {aviso.mensaje}
        </div>
      )}

      <div className="border-line bg-surface overflow-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-subtle text-ink-subtle sticky top-0 z-10">
            <tr>
              <th className="min-w-64 px-3 py-2 font-medium">Material</th>
              <th className="w-36 px-2 py-2 font-medium">Curva</th>
              <th className={`w-16 px-2 py-2 text-right font-medium ${num}`}>Bultos</th>
              {tallas.map((t) => (
                <th key={t} className={`w-14 px-1 py-2 text-center font-medium ${num}`}>
                  {t}
                </th>
              ))}
              <th className={`w-16 px-2 py-2 text-right font-medium ${num}`}>Pares</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {materiales.map((mat, idx) => {
              const linea = lineas[mat.material]
              const curvaCode = linea?.curva || curvaSugerida(curvas, mat.escala)
              const qty = cantidades(linea, curvasPorCodigo.get(curvaCode))
              const total = Object.values(qty).reduce((a, b) => a + b, 0)
              const activa = total > 0

              return (
                <tr key={mat.material} className={activa ? 'bg-interactive/5' : 'hover:bg-surface-hover'}>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-x-2">
                      <span className="text-ink font-medium">{mat.descripcion}</span>
                      {linea?.override && (
                        <span
                          className="border-stock-transito/30 bg-stock-transito/10 text-stock-transito rounded border px-1.5 py-0.5 text-[10px]"
                          title={`Ajustado a mano: ${Object.keys(linea.override).join(', ')}`}
                        >
                          ajustado
                        </span>
                      )}
                    </div>
                    <div className={`text-ink-muted ${num}`}>
                      {mat.material} · {mat.categoria ?? 'Sin clasificar'}
                    </div>
                    <PosicionLinea propio={mat.propioTotal} transito={mat.transitoTotal} proveedor={mat.disponibleTotal} />
                  </td>

                  <td className="px-2 py-1.5">
                    <select
                      value={curvaCode}
                      onChange={(e) => setCurva(mat, e.target.value)}
                      className="border-line bg-surface text-ink w-full rounded border px-1 py-0.5 text-xs"
                    >
                      {curvas
                        .filter((c) => c.scale === mat.escala)
                        .map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} ({c.pairsPerPack})
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
                      value={linea?.packs || ''}
                      onChange={(e) => setPacks(mat, parseInt(e.target.value, 10) || 0)}
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
                      className={`border-line bg-surface text-ink w-full rounded border px-1 py-0.5 text-right text-xs ${num}`}
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
                          className="bg-surface-subtle/40 px-1 py-1.5"
                          title="Este material no existe en esta talla"
                        />
                      )
                    }

                    return (
                      <td key={t} className="px-1 py-1.5">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={pedido || ''}
                          onChange={(e) => setCelda(mat, t, parseInt(e.target.value, 10) || 0)}
                          title={`Marca ${disponible} · tránsito ${info.transito} · bodega ${info.propio}\n${info.sku}`}
                          className={`w-full rounded border px-1 py-0.5 text-center text-xs ${num} ${
                            excede
                              ? 'border-danger bg-surface text-danger'
                              : ajustada
                                ? 'border-stock-transito bg-surface text-ink'
                                : 'border-line bg-surface text-ink'
                          }`}
                        />
                      </td>
                    )
                  })}

                  <td className={`px-2 py-1.5 text-right font-medium ${num} ${activa ? 'text-ink' : 'text-ink-muted'}`}>
                    {total || ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-ink-muted text-xs">
        {materiales.length} materiales con disponibilidad · las celdas en rojo piden más de lo que hay en el
        proveedor · las ámbar se editaron a mano
      </p>
    </div>
  )
}
