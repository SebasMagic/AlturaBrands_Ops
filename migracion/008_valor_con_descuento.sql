-- =============================================================================
-- El valor del embudo debe descontar lo descontado
--
-- `bi.v_embudo` sumaba `cantidad × precio` a secas. Al aparecer los descuentos
-- de proforma esa cifra pasó a estar INFLADA: el tablero comercial mostraría
-- un pipeline mayor que el que realmente se está negociando, que es la peor
-- clase de error en un embudo — el que hace tomar decisiones sobre humo.
--
-- El cálculo replica EXACTAMENTE el de `lib/domain/proforma.ts`, en el mismo
-- orden y con el mismo redondeo:
--   1. por línea:  bruto = cantidad × precio;  desc = round(bruto × pct/100)
--   2. base       = suma de (bruto − desc)
--   3. total      = base − round(base × pct_pie/100)
--
-- Si alguien cambia una de las dos, la otra debe cambiar igual. Están
-- separadas porque una sirve a la pantalla en vivo y la otra a BI, pero
-- describen la misma regla de negocio.
-- =============================================================================

drop view if exists bi.v_embudo_resumen cascade;
drop view if exists bi.v_embudo cascade;

create or replace view bi.v_embudo
with (security_invoker = true) as
with lineas as (
    select
        l.order_id,
        sum(l.quantity)::numeric as pedidas,
        -- Neto de línea: el bruto menos su propio descuento, redondeado una
        -- sola vez. Redondear en cada paso intermedio haría que el total no
        -- cuadrase con la suma de las líneas impresas en la proforma.
        sum(
          (l.quantity * l.unit_price_cents)
          - round((l.quantity * l.unit_price_cents) * l.discount_pct / 100.0)
        )::numeric as base_cents
    from ops.sales_order_line l
    group by l.order_id
),
reservas as (
    select l.order_id, sum(r.quantity)::numeric as reservadas
    from ops.reservation r
    join ops.sales_order_line l on l.id = r.order_line_id
    where r.status = 'ACTIVA'
    group by l.order_id
),
despachos as (
    select
        s.order_id,
        sum(sl.quantity) filter (where s.status in ('EMPACADO','DESPACHADO','ENTREGADO'))::numeric as alistadas,
        sum(sl.quantity) filter (where s.status in ('DESPACHADO','ENTREGADO'))::numeric            as despachadas,
        sum(sl.quantity) filter (where s.status = 'ENTREGADO')::numeric                            as entregadas,
        min(s.packed_at)  as packed_at,
        min(s.shipped_at) as shipped_at,
        max(s.delivered_at) as delivered_at
    from ops.shipment s
    join ops.shipment_line sl on sl.shipment_id = s.id
    where s.status <> 'CANCELADO'
    group by s.order_id
)
select
    so.id as order_id,
    so.code,
    so.currency_code,
    so.created_at,
    so.cancelled_at,
    c.name as cliente,
    o.code as operacion,

    coalesce(l.pedidas, 0) as unidades,
    -- Y aquí cae el descuento de pie, sobre la base ya neta de líneas.
    coalesce(
      l.base_cents - round(l.base_cents * so.discount_pct / 100.0),
      0
    ) as valor_cents,
    coalesce(r.reservadas, 0)  as reservadas,
    coalesce(d.alistadas, 0)   as alistadas,
    coalesce(d.despachadas, 0) as despachadas,
    coalesce(d.entregadas, 0)  as entregadas,

    case
        when so.status = 'CANCELADO'                                then 'CANCELADO'
        when so.status = 'COTIZACION'                               then 'COTIZACION'
        when coalesce(l.pedidas,0) > 0
             and coalesce(d.entregadas,0)  >= l.pedidas             then 'ENTREGADO'
        when coalesce(l.pedidas,0) > 0
             and coalesce(d.despachadas,0) >= l.pedidas             then 'DESPACHADO'
        when coalesce(d.despachadas, 0) > 0                         then 'DESPACHO PARCIAL'
        when coalesce(d.alistadas, 0) > 0                           then 'EMPACADO'
        when coalesce(r.reservadas, 0) > 0                          then 'RESERVADO'
        else                                                             'PEDIDO'
    end as etapa,

    case
        when so.status = 'CANCELADO'                                then 99
        when so.status = 'COTIZACION'                               then 1
        when coalesce(l.pedidas,0) > 0
             and coalesce(d.entregadas,0)  >= l.pedidas             then 7
        when coalesce(l.pedidas,0) > 0
             and coalesce(d.despachadas,0) >= l.pedidas             then 6
        when coalesce(d.despachadas, 0) > 0                         then 5
        when coalesce(d.alistadas, 0) > 0                           then 4
        when coalesce(r.reservadas, 0) > 0                          then 3
        else                                                             2
    end as etapa_orden,

    extract(day from now() - coalesce(
        d.delivered_at, d.shipped_at, d.packed_at, so.confirmed_at, so.created_at
    ))::int as dias_sin_avanzar

from ops.sales_order so
join ops.customer  c on c.id = so.customer_id
join ops.operation o on o.id = so.operation_id
left join lineas    l on l.order_id = so.id
left join reservas  r on r.order_id = so.id
left join despachos d on d.order_id = so.id;

create or replace view bi.v_embudo_resumen
with (security_invoker = true) as
select
    operacion, etapa, etapa_orden,
    count(*)                                     as pedidos,
    sum(unidades)                                as unidades,
    sum(valor_cents)                             as valor_cents,
    max(dias_sin_avanzar)                        as dias_max_sin_avanzar,
    count(*) filter (where dias_sin_avanzar > 7) as atascados
from bi.v_embudo
group by operacion, etapa, etapa_orden;
