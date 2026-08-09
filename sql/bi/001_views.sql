-- =============================================================================
-- Capa BI de AlturaBrands Ops
--
-- Vive en el schema `bi`, separado de `public`, por dos razones:
--   1. Las migraciones de Medusa nunca lo tocan, así que no hay riesgo de que
--      un `db:migrate` borre estas vistas.
--   2. Deja explícito qué es modelo de dominio y qué es capa de lectura.
--
-- Todo aquí es SOLO LECTURA. Escribir en tablas de Medusa desde SQL rompe
-- invariantes del dominio (CLAUDE.md §3): las mutaciones pasan por workflows.
--
-- Idempotente: puede reejecutarse.
-- =============================================================================

create schema if not exists bi;

-- `create or replace view` no admite cambios en la lista de columnas, y estas
-- vistas van a evolucionar. Se recrean desde cero: son capa de lectura pura,
-- no guardan estado, y reconstruirlas es instantáneo.
drop view if exists bi.v_resumen_talla cascade;
drop view if exists bi.v_valorizacion cascade;
drop view if exists bi.v_cobertura_corrida cascade;
drop view if exists bi.v_posicion cascade;
drop view if exists bi.fact_supply cascade;
drop view if exists bi.fact_stock cascade;
drop view if exists bi.dim_variant cascade;
drop view if exists bi.dim_operation cascade;

-- -----------------------------------------------------------------------------
-- dim_operation — las operaciones-país.
--
-- No es multitenant: es una empresa con operaciones en varios países. Por eso
-- la operación es una dimensión más y no una frontera de infraestructura: la
-- gerencia consolida con un `group by`, y la separación operativa se resuelve
-- con permisos y scope en la interfaz.
-- -----------------------------------------------------------------------------
create or replace view bi.dim_operation as
select
    o.code                                          as operacion,
    o.name                                          as operacion_nombre,
    o.currency_code                                 as moneda,
    o.is_active                                     as activa
from operation o
where o.deleted_at is null;

-- -----------------------------------------------------------------------------
-- dim_variant — una fila por variante, con todo lo descriptivo aplanado.
--
-- La talla se expone en dos columnas a propósito: `talla_label` para mostrar
-- ('M 9') y `talla_valor` para ordenar y comparar. Sin la escala, la talla 8
-- de CHILDREN se sumaría con la 8 de MEN, que son zapatos distintos.
-- -----------------------------------------------------------------------------
create or replace view bi.dim_variant as
select
    v.id                                            as variant_id,
    v.sku,
    p.id                                            as product_id,
    p.title                                         as producto,
    p.handle,
    (p.metadata ->> 'material')                     as material,
    (p.metadata ->> 'modelo')                       as modelo,
    (p.metadata ->> 'genero')                       as genero,
    (p.metadata ->> 'color')                        as color,
    c.name                                          as categoria,
    b.code                                          as marca,
    (v.metadata ->> 'escala')                       as escala,
    v.title                                         as talla_label,
    nullif(v.metadata ->> 'talla_valor', 'null')::numeric as talla_valor,
    coalesce((v.metadata ->> 'pendiente_desglose')::boolean, false)
                                                    as pendiente_desglose,
    -- Precio de venta nativo de Medusa: unidad MAYOR (dólares), no centavos.
    pr.amount                                       as msrp_usd,
    -- Campos propios: enteros en centavos. El sufijo hace explícita la unidad.
    nullif(p.metadata ->> 'costo_usd_cents', 'null')::bigint
                                                    as costo_usd_cents,
    nullif(p.metadata ->> 'precio_proveedor_usd_cents', 'null')::bigint
                                                    as precio_proveedor_usd_cents
from product_variant v
join product p
     on p.id = v.product_id and p.deleted_at is null
left join product_category_product pcp
     on pcp.product_id = p.id
left join product_category c
     on c.id = pcp.product_category_id and c.deleted_at is null
left join product_product_brand_brand pb
     on pb.product_id = p.id and pb.deleted_at is null
left join brand b
     on b.id = pb.brand_id and b.deleted_at is null
left join product_variant_price_set vps
     on vps.variant_id = v.id and vps.deleted_at is null
left join price pr
     on pr.price_set_id = vps.price_set_id
    and pr.deleted_at is null
    and pr.currency_code = 'usd'
where v.deleted_at is null;

-- -----------------------------------------------------------------------------
-- fact_stock — existencias PROPIAS, por variante y bodega.
--
-- `disponible` descuenta lo reservado: es lo que un vendedor puede comprometer
-- hoy sin pisar una reserva existente.
-- -----------------------------------------------------------------------------
create or replace view bi.fact_stock as
select
    ii.sku,
    coalesce(o.code, 'SIN_OPERACION')               as operacion,
    sl.id                                           as bodega_id,
    sl.name                                         as bodega,
    il.stocked_quantity::bigint                     as en_bodega,
    il.reserved_quantity::bigint                    as reservado,
    (il.stocked_quantity - il.reserved_quantity)::bigint as disponible,
    il.incoming_quantity::bigint                    as en_camino
from inventory_level il
join inventory_item ii
     on ii.id = il.inventory_item_id and ii.deleted_at is null
join stock_location sl
     on sl.id = il.location_id and sl.deleted_at is null
-- La bodega pertenece a una operación vía Module Link: `stock_location` es del
-- core y no se le añaden columnas (CLAUDE.md §4.2).
left join operation_operation_stock_location_stock_location osl
     on osl.stock_location_id = sl.id and osl.deleted_at is null
left join operation o
     on o.id = osl.operation_id and o.deleted_at is null
where il.deleted_at is null;

-- -----------------------------------------------------------------------------
-- fact_supply — mercancía que TODAVÍA NO es nuestra.
--
-- Deliberadamente separada de fact_stock. Estas unidades no se pueden reservar
-- ni despachar: SUPPLIER requiere una orden de compra, IN_TRANSIT aún no llega.
-- -----------------------------------------------------------------------------
create or replace view bi.fact_supply as
select
    sa.sku,
    sa.operation_code                               as operacion,
    sa.material_code,
    sa.source                                       as origen,
    sa.kind                                         as tipo,
    sa.eta_days                                     as eta_dias,
    sa.quantity::bigint                             as unidades
from supply_availability sa
where sa.deleted_at is null;

-- -----------------------------------------------------------------------------
-- v_posicion — LA vista para el día a día.
--
-- Une las tres naturalezas en una sola rejilla, sin sumarlas: cada una en su
-- columna. Sumar "propio" con "disponible en el proveedor" es exactamente el
-- error que este modelo existe para impedir.
-- -----------------------------------------------------------------------------
-- El grano es (variante, operación). Las claves se construyen uniendo ambos
-- hechos: una variante puede tener existencias en un país, disponibilidad de
-- proveedor en otro, o ambas. Así la vista sirve igual con un país que con
-- cinco, sin tocar una línea.
create or replace view bi.v_posicion as
with claves as (
    select sku, operacion from bi.fact_stock
    union
    select sku, operacion from bi.fact_supply
),
stock as (
    select sku, operacion,
           sum(en_bodega)  as en_bodega,
           sum(reservado)  as reservado,
           sum(disponible) as disponible
    from bi.fact_stock
    group by sku, operacion
),
supply as (
    select sku, operacion,
           sum(unidades) filter (where tipo = 'IN_TRANSIT') as en_transito,
           sum(unidades) filter (where tipo = 'SUPPLIER')   as en_proveedor
    from bi.fact_supply
    group by sku, operacion
)
select
    k.operacion,
    d.sku,
    d.material,
    d.producto,
    d.marca,
    d.categoria,
    d.modelo,
    d.genero,
    d.color,
    d.escala,
    d.talla_label,
    d.talla_valor,
    d.pendiente_desglose,
    d.msrp_usd,
    d.costo_usd_cents,
    coalesce(s.en_bodega, 0)                        as propio,
    coalesce(s.reservado, 0)                        as reservado,
    coalesce(s.disponible, 0)                       as vendible_hoy,
    coalesce(sp.en_transito, 0)                     as en_transito,
    coalesce(sp.en_proveedor, 0)                    as en_proveedor,
    coalesce(s.en_bodega, 0) + coalesce(sp.en_transito, 0) as propio_mas_transito
from claves k
join bi.dim_variant d
     on d.sku = k.sku
left join stock s
     on s.sku = k.sku and s.operacion = k.operacion
left join supply sp
     on sp.sku = k.sku and sp.operacion = k.operacion;

-- -----------------------------------------------------------------------------
-- v_cobertura_corrida — salud del surtido por material.
--
-- Un material con 200 pares concentrados en dos tallas está peor surtido que
-- otro con 60 repartidos en diez. Esta vista mide eso, que es lo que decide
-- si hay que reponer.
-- -----------------------------------------------------------------------------
create or replace view bi.v_cobertura_corrida as
select
    operacion,
    material,
    marca,
    categoria,
    modelo,
    genero,
    color,
    count(*) filter (where not pendiente_desglose)          as tallas_en_corrida,
    count(*) filter (where propio > 0)                      as tallas_con_propio,
    count(*) filter (where en_proveedor > 0)                as tallas_en_proveedor,
    round(
        100.0 * count(*) filter (where propio > 0)
        / nullif(count(*) filter (where not pendiente_desglose), 0),
        1
    )                                                       as pct_cobertura_propia,
    sum(propio)                                             as propio,
    sum(en_transito)                                        as en_transito,
    sum(en_proveedor)                                       as en_proveedor
from bi.v_posicion
group by operacion, material, marca, categoria, modelo, genero, color;

-- -----------------------------------------------------------------------------
-- v_valorizacion — inventario propio a costo y a precio de lista.
--
-- Solo valoriza lo PROPIO. Valorizar la disponibilidad del proveedor inflaría
-- el activo con mercancía ajena.
-- -----------------------------------------------------------------------------
create or replace view bi.v_valorizacion as
select
    operacion,
    categoria,
    genero,
    modelo,
    sum(propio)                                             as pares_propios,
    sum(propio * costo_usd_cents) / 100.0                   as valor_costo_usd,
    sum(propio * msrp_usd)                                  as valor_msrp_usd,
    case
        when sum(propio * msrp_usd) > 0 then round(
            100.0 * (sum(propio * msrp_usd) - sum(propio * costo_usd_cents) / 100.0)
            / sum(propio * msrp_usd),
            1
        )
    end                                                     as margen_pct
from bi.v_posicion
where propio > 0
group by operacion, categoria, genero, modelo;

-- -----------------------------------------------------------------------------
-- v_resumen_talla — demanda potencial por talla dentro de cada escala.
--
-- Agrupa por escala además de por talla: sin eso, la 8 de CHILDREN se sumaría
-- con la 8 de MEN y el resultado no significaría nada.
-- -----------------------------------------------------------------------------
create or replace view bi.v_resumen_talla as
select
    operacion,
    escala,
    genero,
    talla_label,
    talla_valor,
    count(distinct material)                                as materiales,
    sum(propio)                                             as propio,
    sum(en_transito)                                        as en_transito,
    sum(en_proveedor)                                       as en_proveedor
from bi.v_posicion
where not pendiente_desglose
group by operacion, escala, genero, talla_label, talla_valor;
