-- =============================================================================
-- Embudo de ventas y despacho
--
-- La etapa NO se guarda en ninguna columna: se DERIVA de los campos nativos de
-- Medusa. Guardarla aparte crearía una segunda verdad que se desincroniza en
-- cuanto alguien despache desde el admin sin pasar por nuestra pantalla.
--
-- Mapeo de CLAUDE.md §2:
--   cotización → pedido → reserva → alistamiento → empaque → despacho → entregado
--
-- Se calcula por CANTIDADES, no por fechas de despacho. Un pedido con 90 de
-- 100 pares despachados no está despachado: está a medias, y esa distinción
-- es justo lo que el coordinador necesita ver.
-- =============================================================================

drop view if exists bi.v_embudo_resumen cascade;
drop view if exists bi.v_embudo cascade;

create or replace view bi.v_embudo as
with lineas as (
    -- El precio se toma de `order_line_item`, NO de `order_item`: este último
    -- deja `unit_price` en null salvo en flujos de edición de pedido, y usarlo
    -- daba un valor de cero en todo el embudo sin que nada fallara.
    select
        oi.order_id,
        sum(oi.quantity)::numeric                       as pedidas,
        sum(oi.fulfilled_quantity)::numeric             as alistadas,
        sum(oi.shipped_quantity)::numeric               as despachadas,
        sum(oi.delivered_quantity)::numeric             as entregadas,
        sum(oi.quantity * coalesce(oi.unit_price, li.unit_price, 0)) as valor
    from order_item oi
    join order_line_item li
         on li.id = oi.item_id and li.deleted_at is null
    where oi.deleted_at is null
    group by oi.order_id
),
reservas as (
    select oi.order_id, count(*)::int as reservas
    from reservation_item ri
    join order_item oi
         on oi.item_id = ri.line_item_id and oi.deleted_at is null
    where ri.deleted_at is null
    group by oi.order_id
),
fechas as (
    select
        ofl.order_id,
        min(f.packed_at)                                as packed_at,
        min(f.shipped_at)                               as shipped_at,
        max(f.delivered_at)                             as delivered_at
    from order_fulfillment ofl
    join fulfillment f
         on f.id = ofl.fulfillment_id and f.deleted_at is null
    where ofl.deleted_at is null
    group by ofl.order_id
)
select
    o.id                                            as order_id,
    o.display_id,
    o.currency_code,
    o.created_at,
    o.canceled_at,
    coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        c.email,
        o.email,
        '(sin cliente)'
    )                                               as cliente,
    coalesce(l.pedidas, 0)                          as unidades,
    coalesce(l.valor, 0)                            as valor,
    coalesce(r.reservas, 0)                         as reservas,
    coalesce(l.alistadas, 0)                        as alistadas,
    coalesce(l.despachadas, 0)                      as despachadas,
    coalesce(l.entregadas, 0)                       as entregadas,

    -- Del estado más avanzado al menos: el primer acierto gana.
    case
        when o.canceled_at is not null                          then 'CANCELADO'
        when o.is_draft_order                                   then 'COTIZACION'
        when l.pedidas > 0 and l.entregadas >= l.pedidas        then 'ENTREGADO'
        when l.pedidas > 0 and l.despachadas >= l.pedidas       then 'DESPACHADO'
        when coalesce(l.despachadas, 0) > 0                     then 'DESPACHO PARCIAL'
        when coalesce(l.alistadas, 0) > 0                       then 'EMPACADO'
        when coalesce(r.reservas, 0) > 0                        then 'RESERVADO'
        else                                                         'PEDIDO'
    end                                             as etapa,

    case
        when o.canceled_at is not null                          then 99
        when o.is_draft_order                                   then 1
        when l.pedidas > 0 and l.entregadas >= l.pedidas        then 7
        when l.pedidas > 0 and l.despachadas >= l.pedidas       then 6
        when coalesce(l.despachadas, 0) > 0                     then 5
        when coalesce(l.alistadas, 0) > 0                       then 4
        when coalesce(r.reservas, 0) > 0                        then 3
        else                                                         2
    end                                             as etapa_orden,

    -- Días desde el último movimiento REAL. No importa cuándo se creó el
    -- pedido, sino cuánto lleva sin avanzar: eso es lo que delata un atasco.
    extract(day from now() - coalesce(
        d.delivered_at, d.shipped_at, d.packed_at, o.updated_at, o.created_at
    ))::int                                         as dias_sin_avanzar
from "order" o
left join customer c on c.id = o.customer_id and c.deleted_at is null
left join lineas   l on l.order_id = o.id
left join reservas r on r.order_id = o.id
left join fechas   d on d.order_id = o.id
where o.deleted_at is null;

-- Una fila por etapa: es la consulta del tablero.
create or replace view bi.v_embudo_resumen as
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
