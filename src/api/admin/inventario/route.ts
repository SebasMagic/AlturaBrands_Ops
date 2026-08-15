import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/**
 * Posición de inventario agrupada por producto.
 *
 * La lista nativa de Medusa tiene el grano equivocado para esta operación:
 * muestra una fila por talla, con el título de la variante ("M 7") y sin
 * decir de qué producto es. Aquí el grano es el material — modelo + color —
 * que es como el negocio piensa el surtido, y las tallas van dentro.
 *
 * Se sirve de `bi.v_posicion` por la misma razón que la grilla de pedido: es
 * la única vista que cruza existencias propias, tránsito y disponibilidad de
 * proveedor sin sumarlos entre sí.
 *
 * GET /admin/inventario?operacion=CO&marca=KEEN&genero=MEN&q=newport&con_stock=true
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const {
    operacion = 'CO',
    marca,
    genero,
    categoria,
    q,
    con_stock,
  } = req.query as Record<string, string | undefined>

  // El toggle llega como texto por querystring.
  const soloConStock = con_stock === 'true'

  const filas = await knex.raw(
    `
    select
      v.material,
      max(pr.id)              as producto_id,
      max(pr.thumbnail)       as foto,
      max(v.producto)         as descripcion,
      max(v.marca)            as marca,
      max(v.modelo)           as modelo,
      max(v.color)            as color,
      max(v.genero)           as genero,
      max(v.categoria)        as categoria,
      max(v.escala)           as escala,
      sum(v.propio)::int         as propio,
      sum(v.reservado)::int      as reservado,
      sum(v.vendible_hoy)::int   as vendible,
      sum(v.en_transito)::int    as transito,
      sum(v.en_proveedor)::int   as proveedor,
      count(*) filter (where v.propio > 0)::int as tallas_con_stock,
      count(*)::int                             as tallas_total,
      jsonb_agg(
        jsonb_build_object(
          'sku',       v.sku,
          'talla',     v.talla_label,
          'propio',    v.propio,
          'reservado', v.reservado,
          'transito',  v.en_transito,
          'proveedor', v.en_proveedor
        )
        -- Las tallas se ordenan por su valor numérico, no por la etiqueta:
        -- alfabéticamente 'M 10' iría antes que 'M 9'.
        order by v.talla_valor nulls last, v.talla_label
      ) as tallas
    from bi.v_posicion v
    left join product pr
      on pr.metadata->>'material' = v.material
     and pr.deleted_at is null
    where v.operacion = ?
      -- El cast explícito es obligatorio: sin él Postgres no puede inferir el
      -- tipo de un parámetro que llega nulo y aborta con 42P18.
      and (?::text is null or v.marca = ?)
      and (?::text is null or v.genero = ?)
      and (?::text is null or v.categoria = ?)
      and (
        ?::text is null
        or v.producto ilike '%' || ? || '%'
        or v.material ilike '%' || ? || '%'
        or v.modelo   ilike '%' || ? || '%'
      )
    group by v.material
    -- El toggle vive en HAVING porque filtra sobre el agregado: un material
    -- "con existencia" es el que suma algo entre todas sus tallas.
    having (?::boolean is not true or sum(v.propio) > 0)
    order by sum(v.propio) desc, max(v.modelo), max(v.color)
    `,
    [
      operacion,
      marca ?? null,
      marca ?? null,
      genero ?? null,
      genero ?? null,
      categoria ?? null,
      categoria ?? null,
      q ?? null,
      q ?? null,
      q ?? null,
      q ?? null,
      soloConStock,
    ]
  )

  const rows = filas.rows ?? []

  // El resumen se calcula sobre lo filtrado, no sobre todo el catálogo: las
  // tarjetas resumen lo que el usuario está mirando, que es lo que espera.
  const suma = (c: string) =>
    rows.reduce((a: number, r: any) => a + Number(r[c] ?? 0), 0)

  // Para saber cuántos géneros y categorías ofrecer en los filtros hace falta
  // el universo completo, no el filtrado.
  const dimensiones = await knex.raw(
    `select
       array_agg(distinct marca)     filter (where marca is not null)     as marcas,
       array_agg(distinct genero)    filter (where genero is not null)    as generos,
       array_agg(distinct categoria) filter (where categoria is not null) as categorias
     from bi.v_posicion
     where operacion = ?`,
    [operacion]
  )

  res.json({
    operacion,
    resumen: {
      materiales: rows.length,
      // Cuántos modelos no tienen un solo par propio. Es el número que
      // explica por qué "todo se ve en cero" mirando solo la bodega.
      sin_stock_propio: rows.filter((r: any) => Number(r.propio) === 0).length,
      propio: suma('propio'),
      reservado: suma('reservado'),
      transito: suma('transito'),
      proveedor: suma('proveedor'),
    },
    marcas: dimensiones.rows?.[0]?.marcas ?? [],
    generos: dimensiones.rows?.[0]?.generos ?? [],
    categorias: dimensiones.rows?.[0]?.categorias ?? [],
    materiales: rows,
  })
}
