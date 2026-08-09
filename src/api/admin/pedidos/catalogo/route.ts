import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

import { SIZE_CURVE_MODULE } from '../../../../modules/size-curve'

/**
 * Datos para la grilla de pedido.
 *
 * Se sirve desde `bi.v_posicion`, que ya resuelve el cruce de catálogo,
 * existencias propias, tránsito y disponibilidad de proveedor. Reimplementar
 * ese cruce aquí sería mantener dos verdades sobre lo mismo.
 *
 * GET /admin/pedidos/catalogo?operacion=CO&marca=KEEN&genero=MEN&q=jasper
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const curveService: any = req.scope.resolve(SIZE_CURVE_MODULE)

  const {
    operacion = 'CO',
    marca = 'KEEN',
    genero,
    categoria,
    q,
  } = req.query as Record<string, string | undefined>

  // Una fila por material con su disponibilidad desglosada por talla. El
  // agregado se hace en Postgres: traer 3.064 variantes al navegador para
  // agruparlas allí sería absurdo.
  const filas = await knex.raw(
    `
    select
      p.material,
      max(p.producto)                         as descripcion,
      max(p.modelo)                           as modelo,
      max(p.genero)                           as genero,
      max(p.categoria)                        as categoria,
      max(p.color)                            as color,
      max(p.escala)                           as escala,
      max(p.msrp_usd)                         as msrp_usd,
      max(p.costo_usd_cents)                  as costo_usd_cents,
      sum(p.en_proveedor)                     as disponible_total,
      sum(p.propio)                           as propio_total,
      sum(p.en_transito)                      as transito_total,
      -- La clave es la talla PELADA ('8.5'), no la etiqueta con escala
      -- ('M 8.5'): las curvas se definen por número, y con el prefijo no
      -- cruzarían nunca. La escala ya viaja en su propia columna.
      jsonb_object_agg(
        split_part(p.talla_label, ' ', 2),
        jsonb_build_object(
          'sku', p.sku,
          'disponible', p.en_proveedor,
          'propio', p.propio,
          'transito', p.en_transito
        )
      )                                       as tallas
    from bi.v_posicion p
    where p.operacion = ?
      and p.marca = ?
      and not p.pendiente_desglose
      -- El cast explícito es obligatorio: sin él Postgres no puede inferir el
      -- tipo de un parámetro que llega nulo y aborta con 42P18.
      and (?::text is null or p.genero = ?)
      and (?::text is null or p.categoria = ?)
      and (
        ?::text is null
        or p.producto ilike '%' || ? || '%'
        or p.material ilike '%' || ? || '%'
      )
    group by p.material
    having sum(p.en_proveedor) > 0
    order by max(p.modelo), max(p.color)
    `,
    [
      operacion,
      marca,
      genero ?? null,
      genero ?? null,
      categoria ?? null,
      categoria ?? null,
      q ?? null,
      q ?? null,
      q ?? null,
    ]
  )

  const curvas = await curveService.listSizeCurves(
    { is_active: true },
    { relations: ['entries'] }
  )

  // Columnas de talla presentes, ordenadas numéricamente. Se derivan de las
  // curvas y no se codifican a mano: al añadir una marca con otra corrida, la
  // grilla se adapta sola.
  const tallas = [
    ...new Set(
      curvas.flatMap((c: any) => (c.entries ?? []).map((e: any) => e.size_label))
    ),
  ].sort((a, b) => parseFloat(a as string) - parseFloat(b as string))

  res.json({
    operacion,
    marca,
    tallas,
    curvas: curvas.map((c: any) => ({
      code: c.code,
      name: c.name,
      scale: c.scale,
      pairs_per_pack: c.pairs_per_pack,
      is_default: c.is_default,
      entries: (c.entries ?? [])
        .map((e: any) => ({
          size_label: e.size_label,
          size_value: Number(e.size_value),
          ratio: Number(e.ratio),
        }))
        .sort((a: any, b: any) => a.size_value - b.size_value),
    })),
    materiales: (filas.rows ?? []).map((r: any) => ({
      ...r,
      disponible_total: Number(r.disponible_total),
      propio_total: Number(r.propio_total),
      transito_total: Number(r.transito_total),
      msrp_usd: r.msrp_usd === null ? null : Number(r.msrp_usd),
      costo_usd_cents:
        r.costo_usd_cents === null ? null : Number(r.costo_usd_cents),
    })),
  })
}
