import { getPool } from './pool'

export type Talla = {
  sku: string
  talla: string
  propio: number
  reservado: number
  transito: number
  proveedor: number
}

export type MaterialFila = {
  material: string
  productoId: number | null
  foto: string | null
  descripcion: string
  marca: string
  modelo: string
  color: string
  genero: string
  categoria: string | null
  escala: string
  propio: number
  reservado: number
  vendible: number
  transito: number
  proveedor: number
  tallasConStock: number
  tallasTotal: number
  tallas: Talla[]
}

export type FiltrosInventario = {
  operacion: string
  marca?: string
  genero?: string
  categoria?: string
  q?: string
  soloConStock: boolean
}

export type Dimensiones = {
  marcas: string[]
  generos: string[]
  categorias: string[]
}

/**
 * Posición de inventario agrupada por material (modelo + color).
 *
 * Portado de `src/api/admin/inventario/route.ts` (Fase 3 anterior sobre
 * Medusa). Misma consulta, misma razón de ser (CLAUDE.md §6): el grano es el
 * material, no la variante, porque así piensa el negocio el surtido.
 *
 * Placeholders posicionales de `pg`, no los `?` repetidos de knex: cada valor
 * se referencia por número tantas veces como haga falta sin duplicarlo en el
 * array de parámetros.
 */
export async function obtenerPosicion(
  filtros: FiltrosInventario
): Promise<MaterialFila[]> {
  const pool = getPool()

  const { rows } = await pool.query(
    `
    select
      v.material,
      max(p.id)                as producto_id,
      max(p.thumbnail_url)     as foto,
      max(v.producto)          as descripcion,
      max(v.marca)             as marca,
      max(v.modelo)            as modelo,
      max(v.color)             as color,
      max(v.genero)            as genero,
      max(v.categoria)         as categoria,
      max(v.escala)            as escala,
      sum(v.propio)::int          as propio,
      sum(v.reservado)::int       as reservado,
      sum(v.vendible_hoy)::int    as vendible,
      sum(v.en_transito)::int     as transito,
      sum(v.en_proveedor)::int    as proveedor,
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
        -- Por valor numérico, no por etiqueta: alfabéticamente 'M 10' iría
        -- antes que 'M 9' (CLAUDE.md §6).
        order by v.talla_valor nulls last, v.talla_label
      ) as tallas
    from bi.v_posicion v
    left join ops.product p
      on p.material = v.material
    where v.operacion = $1
      and ($2::text is null or v.marca = $2)
      and ($3::text is null or v.genero = $3)
      and ($4::text is null or v.categoria = $4)
      and (
        $5::text is null
        or v.producto ilike '%' || $5 || '%'
        or v.material ilike '%' || $5 || '%'
        or v.modelo   ilike '%' || $5 || '%'
      )
    group by v.material
    -- HAVING porque filtra sobre el agregado: un material "con existencia" es
    -- el que suma algo entre todas sus tallas.
    having ($6::boolean is not true or sum(v.propio) > 0)
    order by sum(v.propio) desc, max(v.modelo), max(v.color)
    `,
    [
      filtros.operacion,
      filtros.marca ?? null,
      filtros.genero ?? null,
      filtros.categoria ?? null,
      filtros.q ?? null,
      filtros.soloConStock,
    ]
  )

  return rows.map((r) => ({
    material: r.material,
    productoId: r.producto_id,
    foto: r.foto,
    descripcion: r.descripcion,
    marca: r.marca,
    modelo: r.modelo,
    color: r.color,
    genero: r.genero,
    categoria: r.categoria,
    escala: r.escala,
    propio: r.propio,
    reservado: r.reservado,
    vendible: r.vendible,
    transito: r.transito,
    proveedor: r.proveedor,
    tallasConStock: r.tallas_con_stock,
    tallasTotal: r.tallas_total,
    tallas: r.tallas,
  }))
}

/** Universo de valores para poblar los selectores de filtro. */
export async function obtenerDimensiones(operacion: string): Promise<Dimensiones> {
  const pool = getPool()

  const { rows } = await pool.query(
    `
    select
      array_agg(distinct marca)     filter (where marca is not null)     as marcas,
      array_agg(distinct genero)    filter (where genero is not null)    as generos,
      array_agg(distinct categoria) filter (where categoria is not null) as categorias
    from bi.v_posicion
    where operacion = $1
    `,
    [operacion]
  )

  return {
    marcas: rows[0]?.marcas ?? [],
    generos: rows[0]?.generos ?? [],
    categorias: rows[0]?.categorias ?? [],
  }
}
