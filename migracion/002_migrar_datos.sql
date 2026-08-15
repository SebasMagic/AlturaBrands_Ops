-- =============================================================================
-- Fase 2 — Migración de datos: `public` (Medusa) → `ops`
--
-- Todo con `insert … select` entre schemas del MISMO proyecto Supabase. Sin
-- exportar, sin importar, sin ventana de corte: `public` queda intacto y
-- consultable, así que los dos mundos se pueden comparar fila a fila.
--
-- Se ejecuta ENTERO dentro de una transacción (lo hace `aplicar.mjs`): o migra
-- todo o no migra nada. Con 3.064 variantes y 3.301 filas de abastecimiento
-- tarda segundos, no vale la pena partirlo.
--
-- El orden respeta las foreign keys: catálogo → inventario → abastecimiento.
--
-- -----------------------------------------------------------------------------
-- Verificado contra los datos antes de escribir esto:
--   · 0 huérfanos en los 5 mapeos por SKU (stock, kardex, supply, PO, recepción)
--   · 3.064 SKUs únicos para 3.064 variantes — el SKU es clave natural válida
--   · 0 tallas duplicadas dentro de un material
--   · 0 productos sin escala, 0 movimientos de kardex en cero
--   · 0 filas SUPPLIER con ETA (la restricción supply_eta_solo_en_transito vale)
--
-- Los JOIN son INNER a propósito donde la columna destino es NOT NULL: si algo
-- no mapea, el conteo de la verificación lo delata. Preferimos un número que no
-- cuadra a una fila inventada.
-- =============================================================================

-- Permite reejecutar mientras iteramos la migración. Seguro SOLO en esta fase:
-- en cuanto `ops` reciba escrituras reales de la aplicación, esto se borra.
truncate table
    ops.goods_receipt_line, ops.goods_receipt,
    ops.purchase_order_size, ops.purchase_order_item, ops.purchase_order,
    ops.size_curve_entry, ops.size_curve,
    ops.supply_availability, ops.stock_move, ops.stock,
    ops.warehouse, ops.variant, ops.product, ops.category,
    ops.operation_brand, ops.brand, ops.operation
restart identity cascade;


-- =============================================================================
-- CATÁLOGO
-- =============================================================================

insert into ops.operation (code, name, currency_code, is_active)
select code, name, currency_code, is_active
from operation where deleted_at is null;

insert into ops.brand (code, name, order_unit, default_pack_size)
select code, name, order_unit, default_pack_size
from brand where deleted_at is null;

insert into ops.operation_brand (operation_id, brand_id)
select oo.id, ob2.id
from operation_operation_brand_brand l
join operation mo on mo.id = l.operation_id and mo.deleted_at is null
join brand    mb on mb.id = l.brand_id     and mb.deleted_at is null
join ops.operation oo on oo.code = mo.code
join ops.brand     ob2 on ob2.code = mb.code
where l.deleted_at is null;

-- Las 6 categorías son planas hoy (ninguna tiene padre). `parent_id` queda
-- nulo; la jerarquía existe en el modelo para cuando el negocio la necesite.
insert into ops.category (name, handle, is_active)
select name, handle, is_active
from product_category where deleted_at is null;

-- -----------------------------------------------------------------------------
-- product — aquí se aplana el metadata JSON a columnas tipadas.
--
-- `escala_talla` del producto pasa a ser `scale`. Se descartó la copia que
-- vivía en la variante: las únicas 90 filas donde diferían eran las variantes
-- fuera de corrida, que simplemente la tenían nula.
-- -----------------------------------------------------------------------------
insert into ops.product (
    material, brand_id, category_id, modelo, color, genero, scale,
    handle, thumbnail_url, costo_usd_cents, precio_proveedor_usd_cents, is_active)
select
    p.metadata ->> 'material',
    ob.id,
    oc.id,
    p.metadata ->> 'modelo',
    p.metadata ->> 'color',
    p.metadata ->> 'genero',
    p.metadata ->> 'escala_talla',
    p.handle,
    p.thumbnail,
    -- nullif contra el texto 'null': el JSON guarda el literal, no un SQL NULL.
    nullif(p.metadata ->> 'costo_usd_cents', 'null')::int,
    nullif(p.metadata ->> 'precio_proveedor_usd_cents', 'null')::int,
    p.status = 'published'
from product p
join product_product_brand_brand pb on pb.product_id = p.id and pb.deleted_at is null
join brand mb on mb.id = pb.brand_id and mb.deleted_at is null
join ops.brand ob on ob.code = mb.code
left join product_category_product pcp on pcp.product_id = p.id
left join product_category mc on mc.id = pcp.product_category_id and mc.deleted_at is null
left join ops.category oc on oc.handle = mc.handle
where p.deleted_at is null;

-- -----------------------------------------------------------------------------
-- variant
--
-- El precio se trae con subconsulta y no con JOIN: un price_set puede tener
-- varias filas en `price` y el join multiplicaría variantes silenciosamente.
-- El nativo de Medusa está en unidad MAYOR (dólares), así que ×100 a centavos
-- para cumplir la regla de dinero en enteros (CLAUDE.md §6).
-- -----------------------------------------------------------------------------
insert into ops.variant (
    product_id, sku, size_label, size_value, is_off_curve, upc, msrp_usd_cents, is_active)
select
    op.id,
    v.sku,
    v.title,
    nullif(v.metadata ->> 'talla_valor', 'null')::numeric(4,1),
    coalesce((v.metadata ->> 'pendiente_desglose')::boolean, false),
    v.upc,
    (select round(pr.amount * 100)::int
       from product_variant_price_set vps
       join price pr on pr.price_set_id = vps.price_set_id
                    and pr.deleted_at is null
                    and pr.currency_code = 'usd'
      where vps.variant_id = v.id and vps.deleted_at is null
      limit 1),
    true
from product_variant v
join product p  on p.id = v.product_id and p.deleted_at is null
join ops.product op on op.material = p.metadata ->> 'material'
where v.deleted_at is null;


-- =============================================================================
-- INVENTARIO
-- =============================================================================

-- `stock_location` no tiene código en Medusa, sólo nombre. Se deriva uno
-- estable a partir del nombre: 'Bodega Matriz' → 'BODEGA_MATRIZ'.
insert into ops.warehouse (code, name, operation_id)
select
    upper(regexp_replace(trim(sl.name), '[^a-zA-Z0-9]+', '_', 'g')),
    sl.name,
    oo.id
from stock_location sl
join operation_operation_stock_location_stock_location osl
     on osl.stock_location_id = sl.id and osl.deleted_at is null
join operation mo on mo.id = osl.operation_id and mo.deleted_at is null
join ops.operation oo on oo.code = mo.code
where sl.deleted_at is null;

insert into ops.stock (variant_id, warehouse_id, qty, reserved)
select ov.id, ow.id, il.stocked_quantity, il.reserved_quantity
from inventory_level il
join inventory_item ii on ii.id = il.inventory_item_id and ii.deleted_at is null
join ops.variant ov on ov.sku = ii.sku
join stock_location sl on sl.id = il.location_id and sl.deleted_at is null
join ops.warehouse ow on ow.name = sl.name
where il.deleted_at is null;

-- El kardex conserva su `created_at` original: es un histórico, y reescribir
-- las fechas destruiría justamente lo que lo hace auditable.
insert into ops.stock_move (
    variant_id, warehouse_id, kind, quantity,
    reference_type, reference_id, balance_after, notes, created_at)
select
    ov.id, ow.id, sm.kind, sm.quantity,
    sm.reference_type, sm.reference_id, sm.balance_after, sm.notes, sm.created_at
from stock_move sm
join ops.variant ov on ov.sku = sm.sku
join stock_location sl on sl.id = sm.warehouse_id and sl.deleted_at is null
join ops.warehouse ow on ow.name = sl.name
where sm.deleted_at is null;


-- =============================================================================
-- ABASTECIMIENTO
-- =============================================================================

insert into ops.supply_availability (
    variant_id, operation_id, source, kind, eta_days, quantity)
select ov.id, oo.id, sa.source, sa.kind, sa.eta_days, sa.quantity
from supply_availability sa
join ops.variant ov on ov.sku = sa.sku
join ops.operation oo on oo.code = sa.operation_code
where sa.deleted_at is null;

insert into ops.size_curve (
    code, brand_id, name, scale, pairs_per_pack, is_default, is_active)
select sc.code, ob.id, sc.name, sc.scale, sc.pairs_per_pack, sc.is_default, sc.is_active
from size_curve sc
join brand_brand_size_curve_size_curve bsc
     on bsc.size_curve_id = sc.id and bsc.deleted_at is null
join brand mb on mb.id = bsc.brand_id and mb.deleted_at is null
join ops.brand ob on ob.code = mb.code
where sc.deleted_at is null;

insert into ops.size_curve_entry (curve_id, size_label, size_value, ratio)
select osc.id, e.size_label, e.size_value::numeric(4,1), e.ratio
from size_curve_entry e
join size_curve sc on sc.id = e.curve_id and sc.deleted_at is null
join ops.size_curve osc on osc.code = sc.code
where e.deleted_at is null;

insert into ops.purchase_order (
    code, operation_id, brand_id, status, currency_code, notes,
    placed_at, qty_checked_at, approved_at, dispatched_at, dispatch_ticket, created_at)
select
    po.code, oo.id, ob.id, po.status, po.currency_code, po.notes,
    po.placed_at, po.qty_checked_at, po.approved_at, po.dispatched_at,
    po.dispatch_ticket, po.created_at
from purchase_order po
join ops.operation oo on oo.code = po.operation_code
join ops.brand     ob on ob.code = po.brand_code
where po.deleted_at is null;

insert into ops.purchase_order_item (
    order_id, product_id, description, size_curve_id, packs,
    is_adjusted, adjustment_note, unit_cost_cents)
select
    opo.id, op.id, i.description, osc.id, i.packs,
    i.is_adjusted, i.adjustment_note, i.unit_cost_cents
from purchase_order_item i
join purchase_order po on po.id = i.order_id and po.deleted_at is null
join ops.purchase_order opo on opo.code = po.code
join ops.product op on op.material = i.material_code
left join ops.size_curve osc on osc.code = i.size_curve_code
where i.deleted_at is null;

insert into ops.purchase_order_size (
    item_id, variant_id, quantity_requested, quantity_confirmed)
select oi.id, ov.id, s.quantity_requested, s.quantity_confirmed
from purchase_order_size s
join purchase_order_item i on i.id = s.item_id and i.deleted_at is null
join purchase_order po on po.id = i.order_id and po.deleted_at is null
join ops.purchase_order opo on opo.code = po.code
join ops.product op on op.material = i.material_code
join ops.purchase_order_item oi on oi.order_id = opo.id and oi.product_id = op.id
join ops.variant ov on ov.sku = s.sku
where s.deleted_at is null;

insert into ops.goods_receipt (
    code, operation_id, purchase_order_id, warehouse_id, status, reference,
    received_at, confirmed_at, received_by, notes, created_at)
select
    gr.code, oo.id, opo.id, ow.id, gr.status, gr.reference,
    gr.received_at, gr.confirmed_at, gr.received_by, gr.notes, gr.created_at
from goods_receipt gr
join ops.operation oo on oo.code = gr.operation_code
left join ops.purchase_order opo on opo.code = gr.purchase_order_code
join stock_location sl on sl.id = gr.warehouse_id and sl.deleted_at is null
join ops.warehouse ow on ow.name = sl.name
where gr.deleted_at is null;

insert into ops.goods_receipt_line (
    receipt_id, variant_id, quantity_expected, quantity_received, discrepancy_note)
select ogr.id, ov.id, l.quantity_expected, l.quantity_received, l.discrepancy_note
from goods_receipt_line l
join goods_receipt gr on gr.id = l.receipt_id and gr.deleted_at is null
join ops.goods_receipt ogr on ogr.code = gr.code
join ops.variant ov on ov.sku = l.sku
where l.deleted_at is null;
