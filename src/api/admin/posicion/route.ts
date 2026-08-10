import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/**
 * Posición de inventario de un SKU: bodega, tránsito y disponible en la marca.
 *
 * Existe porque el módulo `inventory` de Medusa solo conoce el primero de los
 * tres — lo que ya está en una bodega física. El tránsito y la disponibilidad
 * del proveedor viven en `supply-availability`, y sin este endpoint no hay
 * forma de verlos desde las pantallas nativas del admin.
 *
 * Se sirve de `bi.v_posicion`, la misma vista que alimenta la grilla de
 * pedido: dos consultas distintas sobre lo mismo acabarían dando cifras
 * distintas.
 *
 * GET /admin/posicion?sku=1001870-M7[&operacion=CO]
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const { sku, operacion = 'CO' } = req.query as Record<string, string | undefined>

  if (!sku) {
    res.status(400).json({ message: 'Falta el parámetro sku.' })
    return
  }

  // La talla concreta que se está mirando.
  const talla = await knex.raw(
    `select material, modelo, color, genero, talla_label, escala,
            propio::int        as propio,
            en_transito::int   as transito,
            en_proveedor::int  as proveedor
     from bi.v_posicion
     where sku = ? and operacion = ?
     limit 1`,
    [sku, operacion]
  )

  const fila = talla.rows?.[0]
  if (!fila) {
    // No es un error: hay SKU en Medusa que no están en el maestro (demo,
    // altas manuales). El widget lo distingue de un fallo de red.
    res.json({ encontrado: false, sku })
    return
  }

  // El resto de tallas del mismo material, para responder la pregunta que
  // siempre viene después: "¿y de este modelo qué más viene en camino?".
  const tallas = await knex.raw(
    `select talla_label,
            propio::int       as propio,
            en_transito::int  as transito,
            en_proveedor::int as proveedor
     from bi.v_posicion
     where material = ? and operacion = ?
     -- Se extrae la primera cifra de la etiqueta ("M 8.5" → 8.5) en vez de
     -- partir por el espacio: hay etiquetas sin escala, y ahí split_part
     -- devuelve cadena vacía y el cast a numeric aborta la consulta.
     order by nullif(substring(talla_label from '[0-9.]+'), '')::numeric
                nulls last,
              talla_label`,
    [fila.material, operacion]
  )

  const filas = tallas.rows ?? []
  const sumar = (c: string) =>
    filas.reduce((a: number, r: any) => a + Number(r[c] ?? 0), 0)

  res.json({
    encontrado: true,
    operacion,
    sku,
    talla: fila,
    material: {
      material: fila.material,
      modelo: fila.modelo,
      color: fila.color,
      genero: fila.genero,
      propio: sumar('propio'),
      transito: sumar('transito'),
      proveedor: sumar('proveedor'),
    },
    tallas: filas,
  })
}
