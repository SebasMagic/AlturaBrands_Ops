-- =============================================================================
-- Fase 3 — La capa `bi` vuelve a apuntar a `ops`, no a `public` (Medusa)
--
-- Este archivo NO inventa lógica nueva. Es `sql/bi/001_views.sql` y
-- `sql/bi/002_curvas.sql` reescritos para leer del schema propio. La prueba de
-- que la reescritura es fiel es que el test de caracterización
-- (`migracion/caracterizacion.sql`), que se escribió contra los NOMBRES de
-- estas vistas y nunca se toca, tiene que volver a dar 31/31 en verde sin que
-- se le cambie una línea.
--
-- Solo 4 vistas tocan tablas crudas y necesitan reescribirse de verdad:
-- dim_operation, dim_variant, fact_stock, fact_supply y v_posicion. El resto
-- de la capa (v_cobertura_corrida, v_valorizacion, v_resumen_talla) solo lee
-- de bi.v_posicion — no le importa de dónde viene el dato, así que ni se toca.
--
-- Simplificaciones que sí cambian respecto al original, y por qué:
--
--   · `producto` ya no viene de `product.title`. Ese título en Medusa estaba
--     TRUNCADO por el límite de la columna: un color real "SUNSET" quedaba
--     guardado como "SUNSE". Se reconstruye como `modelo · escala-color`,
--     sin ese límite. Verificado contra una muestra: mismo patrón, sin corte.
--     No se usaba para mostrar en ninguna pantalla, solo para buscar.
--
--   · `en_camino` desaparece de `fact_stock`. En Medusa vivía en
--     `inventory_level.incoming_quantity` y sumaba exactamente los mismos
--     10.280 pares que ya está `fact_supply.en_transito` — una segunda copia
--     de la misma cifra. `v_posicion` nunca lo leía. En `ops` el tránsito
--     tiene un solo lugar: `supply_availability`.
--
--   · `v_embudo` y `v_embudo_resumen` quedan como VISTAS VACÍAS con las
--     mismas columnas, no como reescritura real. `order`, `reservation_item` y
--     `fulfillment` de Medusa no tienen todavía equivalente en `ops` — eso es
--     la Fase 5 (comercial), que hoy tiene 0 filas en cualquier caso. El test
--     espera 0 pedidos en el embudo; esto lo cumple sin fingir un dominio que
--     no existe aún. Cuando la Fase 5 cree `ops.order`, este archivo se
--     reemplaza por la lógica real (misma derivación por cantidades, no por
--     fechas — la regla está descrita en CLAUDE.md §6 y no cambia).
--
-- Idempotente: se puede reejecutar mientras iteramos.
-- =============================================================================

create schema if not exists bi;

drop view if exists bi.v_embudo_resumen cascade;
drop view if exists bi.v_embudo cascade;
drop view if exists bi.v_curvas cascade;
drop view if exists bi.v_curva_detalle cascade;
drop view if exists bi.v_resumen_talla cascade;
drop view if exists bi.v_valorizacion cascade;
drop view if exists bi.v_cobertura_corrida cascade;
drop view if exists bi.v_posicion cascade;
drop view if exists bi.fact_supply cascade;
drop view if exists bi.fact_stock cascade;
drop view if exists bi.dim_variant cascade;
drop view if exists bi.dim_operation cascade;


-- -----------------------------------------------------------------------------
-- dim_operation
-- -----------------------------------------------------------------------------
create view bi.dim_operation with (security_invoker = true) as
select
    o.code          as operacion,
    o.name          as operacion_nombre,
    o.currency_code as moneda,
    o.is_active     as activa
from ops.operation o;

-- -----------------------------------------------------------------------------
-- dim_variant — una fila por variante, con todo lo descriptivo aplanado.
--
-- Antes vivía en cinco joins contra tablas de Medusa (price_set, la tabla de
-- enlace de marca, categoría). En `ops` son columnas o FKs directos.
-- -----------------------------------------------------------------------------
create view bi.dim_variant with (security_invoker = true) as
select
    v.id                                    as variant_id,
    v.sku,
    p.id                                    as product_id,
    p.modelo || ' ' || p.scale || '-' || p.color
                                             as producto,
    p.handle,
    p.material,
    p.modelo,
    p.genero,
    p.color,
    c.name                                  as categoria,
    b.code                                  as marca,
    p.scale                                 as escala,
    v.size_label                            as talla_label,
    v.size_value                            as talla_valor,
    v.is_off_curve                          as pendiente_desglose,
    (v.msrp_usd_cents / 100.0)              as msrp_usd,
    p.costo_usd_cents,
    p.precio_proveedor_usd_cents
from ops.variant v
join ops.product p  on p.id = v.product_id
join ops.brand   b  on b.id = p.brand_id
left join ops.category c on c.id = p.category_id;

-- -----------------------------------------------------------------------------
-- fact_stock — existencias PROPIAS, por variante y bodega.
-- -----------------------------------------------------------------------------
create view bi.fact_stock with (security_invoker = true) as
select
    v.sku,
    o.code            as operacion,
    w.id              as bodega_id,
    w.name            as bodega,
    s.qty             as en_bodega,
    s.reserved        as reservado,
    (s.qty - s.reserved) as disponible
from ops.stock s
join ops.variant   v on v.id = s.variant_id
join ops.warehouse w on w.id = s.warehouse_id
join ops.operation o on o.id = w.operation_id;

-- -----------------------------------------------------------------------------
-- fact_supply — mercancía que TODAVÍA NO es nuestra.
-- -----------------------------------------------------------------------------
create view bi.fact_supply with (security_invoker = true) as
select
    v.sku,
    o.code           as operacion,
    p.material       as material_code,
    sa.source        as origen,
    sa.kind          as tipo,
    sa.eta_days      as eta_dias,
    sa.quantity      as unidades
from ops.supply_availability sa
join ops.variant   v on v.id = sa.variant_id
join ops.product   p on p.id = v.product_id
join ops.operation o on o.id = sa.operation_id;

-- -----------------------------------------------------------------------------
-- v_posicion — LA vista para el día a día. Lógica idéntica al original: las
-- tres naturalezas se unen sin sumarse (CLAUDE.md §6).
-- -----------------------------------------------------------------------------
create view bi.v_posicion with (security_invoker = true) as
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
-- v_cobertura_corrida, v_valorizacion, v_resumen_talla
--
-- Sin cambios de fondo: solo leen bi.v_posicion, que ya quedó reescrita
-- arriba. Se recrean igual porque las vistas dependientes se tiraron en
-- cascada.
-- -----------------------------------------------------------------------------
create view bi.v_cobertura_corrida with (security_invoker = true) as
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

create view bi.v_valorizacion with (security_invoker = true) as
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

create view bi.v_resumen_talla with (security_invoker = true) as
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


-- -----------------------------------------------------------------------------
-- v_curva_detalle, v_curvas
-- -----------------------------------------------------------------------------
create view bi.v_curva_detalle with (security_invoker = true) as
select
    c.code           as curva,
    c.name           as nombre,
    c.scale          as escala,
    c.pairs_per_pack as pares_por_bulto,
    c.is_default     as por_defecto,
    c.is_active      as activa,
    b.code           as marca,
    e.size_label     as talla,
    e.size_value     as talla_valor,
    e.ratio          as pares
from ops.size_curve c
join ops.size_curve_entry e on e.curve_id = c.id
join ops.brand b             on b.id = c.brand_id;

create view bi.v_curvas with (security_invoker = true) as
select
    curva,
    marca,
    escala,
    pares_por_bulto,
    por_defecto,
    count(*)                                        as tallas,
    min(talla_valor)                                as talla_min,
    max(talla_valor)                                as talla_max,
    (count(*) <> ((max(talla_valor) - min(talla_valor)) * 2 + 1)::int)
                                                    as tiene_huecos,
    string_agg(talla || ':' || pares, '  ' order by talla_valor)
                                                    as distribucion
from bi.v_curva_detalle
group by curva, marca, escala, pares_por_bulto, por_defecto;


-- -----------------------------------------------------------------------------
-- v_embudo, v_embudo_resumen — PLACEHOLDER hasta la Fase 5.
--
-- Mismas columnas y tipos que la versión sobre Medusa, cero filas: `ops` aún
-- no tiene `order`/`reservation`/`fulfillment` porque lo comercial no se ha
-- diseñado. Esto no es una reescritura, es un contrato de columnas que impide
-- que una pantalla que ya consulte `bi.v_embudo` se rompa por un nombre que no
-- existe. La lógica real (etapa derivada por CANTIDADES, no por fechas) migra
-- entera cuando exista `ops.order` — la regla está en CLAUDE.md §6.
-- -----------------------------------------------------------------------------
create view bi.v_embudo with (security_invoker = true) as
select
    null::text        as order_id,
    null::int         as display_id,
    null::text        as currency_code,
    null::timestamptz as created_at,
    null::timestamptz as canceled_at,
    null::text        as cliente,
    null::numeric     as unidades,
    null::numeric     as valor,
    null::int         as reservas,
    null::numeric     as alistadas,
    null::numeric     as despachadas,
    null::numeric     as entregadas,
    null::text        as etapa,
    null::int         as etapa_orden,
    null::int         as dias_sin_avanzar
where false;

create view bi.v_embudo_resumen with (security_invoker = true) as
select
    etapa,
    etapa_orden,
    count(*)                                        as pedidos,
    sum(unidades)                                   as unidades,
    sum(valor)                                      as valor,
    max(dias_sin_avanzar)                           as dias_max_sin_avanzar,
    count(*) filter (where dias_sin_avanzar > 7)    as atascados
from bi.v_embudo
group by etapa, etapa_orden;
