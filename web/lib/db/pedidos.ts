import { getPool } from './pool'
import type { Curva, MaterialPedido } from '@/lib/domain/pedidos'

export type FiltrosCatalogo = {
  operacion: string
  marca: string
  genero?: string
  categoria?: string
  q?: string
}

/**
 * Catálogo para la grilla de pedido: una fila por material con su
 * disponibilidad desglosada por talla, más las curvas activas de la marca.
 *
 * Portado de `src/api/admin/pedidos/catalogo/route.ts`. Sigue sirviéndose de
 * `bi.v_posicion`: reimplementar ese cruce aquí sería mantener dos verdades
 * sobre lo mismo.
 */
export async function obtenerCatalogoPedido(
  filtros: FiltrosCatalogo
): Promise<{ tallas: string[]; curvas: Curva[]; materiales: MaterialPedido[] }> {
  const pool = getPool()

  const { rows: filas } = await pool.query(
    `
    select
      v.material,
      max(v.producto)         as descripcion,
      max(v.modelo)           as modelo,
      max(v.genero)           as genero,
      max(v.categoria)        as categoria,
      max(v.color)            as color,
      max(v.escala)           as escala,
      max(v.msrp_usd)         as msrp_usd,
      max(v.costo_usd_cents)  as costo_usd_cents,
      sum(v.en_proveedor)     as disponible_total,
      sum(v.propio)           as propio_total,
      sum(v.en_transito)      as transito_total,
      -- La clave es la talla PELADA ('8.5'), no la etiqueta con escala
      -- ('M 8.5'): las curvas se definen por número, y con el prefijo no
      -- cruzarían nunca. La escala ya viaja en su propia columna.
      jsonb_object_agg(
        split_part(v.talla_label, ' ', 2),
        jsonb_build_object(
          'sku', v.sku,
          'disponible', v.en_proveedor,
          'propio', v.propio,
          'transito', v.en_transito
        )
      ) as tallas
    from bi.v_posicion v
    where v.operacion = $1
      and v.marca = $2
      and not v.pendiente_desglose
      and ($3::text is null or v.genero = $3)
      and ($4::text is null or v.categoria = $4)
      and (
        $5::text is null
        or v.producto ilike '%' || $5 || '%'
        or v.material ilike '%' || $5 || '%'
      )
    group by v.material
    having sum(v.en_proveedor) > 0
    order by max(v.modelo), max(v.color)
    `,
    [filtros.operacion, filtros.marca, filtros.genero ?? null, filtros.categoria ?? null, filtros.q ?? null]
  )

  const { rows: curvaRows } = await pool.query(
    `
    select
      c.code, c.name, c.scale, c.pairs_per_pack, c.is_default,
      coalesce(
        jsonb_agg(
          jsonb_build_object('size_label', e.size_label, 'size_value', e.size_value, 'ratio', e.ratio)
          order by e.size_value
        ) filter (where e.id is not null),
        '[]'
      ) as entries
    from ops.size_curve c
    join ops.brand b on b.id = c.brand_id
    left join ops.size_curve_entry e on e.curve_id = c.id
    where b.code = $1 and c.is_active
    group by c.id
    order by c.code
    `,
    [filtros.marca]
  )

  const curvas: Curva[] = curvaRows.map((c) => ({
    code: c.code,
    name: c.name,
    scale: c.scale,
    pairsPerPack: c.pairs_per_pack,
    isDefault: c.is_default,
    entries: (c.entries as { size_label: string; size_value: string; ratio: number }[]).map((e) => ({
      sizeLabel: e.size_label,
      sizeValue: Number(e.size_value),
      ratio: e.ratio,
    })),
  }))

  // Columnas de talla presentes, ordenadas numéricamente. Se derivan de las
  // curvas y no se codifican a mano: al añadir una marca con otra corrida, la
  // grilla se adapta sola.
  const tallas = [...new Set(curvas.flatMap((c) => c.entries.map((e) => e.sizeLabel)))].sort(
    (a, b) => parseFloat(a) - parseFloat(b)
  )

  const materiales: MaterialPedido[] = filas.map((r) => ({
    material: r.material,
    descripcion: r.descripcion,
    modelo: r.modelo,
    genero: r.genero,
    categoria: r.categoria,
    color: r.color,
    escala: r.escala,
    msrpUsd: r.msrp_usd === null ? null : Number(r.msrp_usd),
    costoUsdCents: r.costo_usd_cents === null ? null : Number(r.costo_usd_cents),
    disponibleTotal: Number(r.disponible_total),
    propioTotal: Number(r.propio_total),
    transitoTotal: Number(r.transito_total),
    tallas: r.tallas,
  }))

  return { tallas, curvas, materiales }
}

export type ItemPedidoInput = {
  materialCode: string
  description: string
  sizeCurveCode: string | null
  packs: number
  isAdjusted: boolean
  adjustmentNote: string | null
  unitCostCents: number | null
  sizes: { sku: string; quantityRequested: number }[]
}

export type CrearPedidoInput = {
  operationCode: string
  brandCode: string
  currencyCode: string
  notes?: string | null
  items: ItemPedidoInput[]
}

/**
 * Crea el pedido completo: cabecera, ítems y detalle por talla.
 *
 * En la versión sobre Medusa esto era un workflow de un solo step con
 * compensación manual (`create-order.ts`): "dividirlo en tres dejaría la
 * puerta abierta a un pedido con cabecera y sin líneas si el segundo falla".
 *
 * Aquí la misma garantía la da una TRANSACCIÓN de Postgres, sin bookkeeping
 * de qué borrar si algo falla a medias — Postgres lo hace solo al hacer
 * rollback. Es una simplificación real de salir del motor de workflows de
 * Medusa (CLAUDE.md §2), no solo un cambio de sintaxis.
 */
export async function crearPedido(
  input: CrearPedidoInput
): Promise<{ id: number; code: string; pares: number }> {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('begin')

    const { rows: opRows } = await client.query(
      'select id from ops.operation where code = $1',
      [input.operationCode]
    )
    const { rows: brandRows } = await client.query(
      'select id from ops.brand where code = $1',
      [input.brandCode]
    )
    if (!opRows[0]) throw new Error(`Operación desconocida: ${input.operationCode}`)
    if (!brandRows[0]) throw new Error(`Marca desconocida: ${input.brandCode}`)
    const operationId = opRows[0].id
    const brandId = brandRows[0].id

    // Correlativo por operación y marca — mismo formato que antes: PO-CO-KEEN-0001.
    const { rows: previos } = await client.query(
      'select count(*)::int as n from ops.purchase_order where operation_id = $1 and brand_id = $2',
      [operationId, brandId]
    )
    const code = `PO-${input.operationCode}-${input.brandCode}-${String(previos[0].n + 1).padStart(4, '0')}`

    const { rows: poRows } = await client.query(
      `insert into ops.purchase_order (code, operation_id, brand_id, status, currency_code, notes, placed_at)
       values ($1, $2, $3, 'DRAFT', $4, $5, now())
       returning id`,
      [code, operationId, brandId, input.currencyCode, input.notes ?? null]
    )
    const orderId = poRows[0].id

    let pares = 0
    for (const item of input.items) {
      const { rows: prodRows } = await client.query(
        'select id from ops.product where material = $1',
        [item.materialCode]
      )
      if (!prodRows[0]) throw new Error(`Material ${item.materialCode} no existe en el catálogo`)

      let curveId: number | null = null
      if (item.sizeCurveCode) {
        const { rows: curveRows } = await client.query(
          'select id from ops.size_curve where code = $1',
          [item.sizeCurveCode]
        )
        curveId = curveRows[0]?.id ?? null
      }

      const { rows: itemRows } = await client.query(
        `insert into ops.purchase_order_item
           (order_id, product_id, description, size_curve_id, packs, is_adjusted, adjustment_note, unit_cost_cents)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id`,
        [
          orderId,
          prodRows[0].id,
          item.description,
          curveId,
          item.packs,
          item.isAdjusted,
          item.adjustmentNote,
          item.unitCostCents,
        ]
      )
      const itemId = itemRows[0].id

      for (const size of item.sizes) {
        const { rows: varRows } = await client.query(
          'select id from ops.variant where sku = $1',
          [size.sku]
        )
        if (!varRows[0]) throw new Error(`SKU ${size.sku} no existe`)

        await client.query(
          `insert into ops.purchase_order_size (item_id, variant_id, quantity_requested)
           values ($1,$2,$3)`,
          [itemId, varRows[0].id, size.quantityRequested]
        )
        pares += size.quantityRequested
      }
    }

    await client.query('commit')
    return { id: orderId, code, pares }
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}
