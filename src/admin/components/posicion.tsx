/**
 * Los tres estados del inventario, con un código de color único para todo el
 * ERP.
 *
 * El módulo `inventory` de Medusa solo conoce el primero: lo que ya está en
 * una bodega física. Los otros dos viven en `supply-availability` y son
 * justamente los que no aparecen en las pantallas nativas, de ahí que exista
 * este componente.
 *
 *   BODEGA    verde   — recibido, se puede despachar hoy
 *   TRÁNSITO  ámbar   — despachado por la marca, aún no recibido
 *   MARCA     gris    — disponible en el proveedor, todavía no es nuestro
 *
 * El color significa "qué tan disponible está", no decora (CLAUDE.md §4.5).
 * Un estado en cero se apaga a gris para que la vista no grite por nada.
 */

export type Posicion = {
  propio: number
  transito: number
  proveedor: number
}

/** Miles con separador local. Sin decimales: son pares, nunca fraccionarios. */
export const pares = (n: number) => Math.round(n).toLocaleString('es-CO')

/** Números tabulares: sin esto las cifras bailan al compararlas en columna. */
export const num = 'tabular-nums'

const TONO = {
  propio: 'text-ui-tag-green-text',
  transito: 'text-ui-tag-orange-text',
  proveedor: 'text-ui-fg-subtle',
} as const

const apagado = 'text-ui-fg-muted'

/**
 * Lectura compacta en una línea. Pensada para ir bajo el nombre del producto
 * en listados densos, donde no caben tres columnas.
 */
export const PosicionLinea = ({
  propio,
  transito,
  proveedor,
  className = '',
}: Posicion & { className?: string }) => (
  <span className={`${num} ${className}`}>
    <span className={propio > 0 ? TONO.propio : apagado}>
      bodega {pares(propio)}
    </span>
    <span className={apagado}> · </span>
    <span className={transito > 0 ? TONO.transito : apagado}>
      tránsito {pares(transito)}
    </span>
    <span className={apagado}> · </span>
    <span className={proveedor > 0 ? TONO.proveedor : apagado}>
      marca {pares(proveedor)}
    </span>
  </span>
)

/**
 * Los mismos tres estados en bloque, para fichas de detalle donde sí hay
 * sitio y conviene que el número pese más que la etiqueta.
 */
export const PosicionBloque = ({ propio, transito, proveedor }: Posicion) => {
  const celdas = [
    { etiqueta: 'En bodega', valor: propio, tono: TONO.propio },
    { etiqueta: 'En tránsito', valor: transito, tono: TONO.transito },
    { etiqueta: 'Disponible en la marca', valor: proveedor, tono: TONO.proveedor },
  ]

  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg">
      {celdas.map((c) => (
        <div key={c.etiqueta} className="bg-ui-bg-subtle px-4 py-3">
          <div className="text-ui-fg-muted mb-1 text-xs">{c.etiqueta}</div>
          <div
            className={`text-xl font-semibold ${num} ${
              c.valor > 0 ? c.tono : apagado
            }`}
          >
            {pares(c.valor)}
          </div>
        </div>
      ))}
    </div>
  )
}
