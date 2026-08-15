-- =============================================================================
-- Embudo de ventas y despacho, sobre el schema `ops`
--
-- Reescritura de `sql/bi/003_embudo.sql`, que leía las tablas de Medusa
-- (`order`, `order_item`, `reservation_item`, `fulfillment`). Esas tablas
-- tenían CERO filas — el embudo nunca tuvo datos. Aquí se reconstruye contra
-- el dominio propio.
--
-- Las dos reglas que sobreviven íntegras porque describen el negocio, no la
-- herramienta (CLAUDE.md §6):
--
--   1. LA ETAPA SE DERIVA, NO SE GUARDA. Guardarla en una columna crea una
--      segunda verdad que se desincroniza en cuanto alguien despacha por otra
--      vía.
--
--   2. SE CALCULA POR CANTIDADES, NO POR FECHAS. Un pedido con 90 de 100 pares
--      despachados no está despachado: está a medias, y esa distinción es
--      justo lo que el coordinador necesita ver.
--
-- Idempotente: se tira y se reconstruye, como toda la capa `bi`.
-- =============================================================================

drop view if exists bi.v_embudo_resumen cascade;
drop view if exists bi.v_embudo cascade;

create or replace view bi.v_embudo
with (security_invoker = true) as
with lineas as (
    select
        l.order_id,
        sum(l.quantity)::numeric                             as pedidas,
        sum(l.quantity * l.unit_price_cents)::numeric        as valor_cents
    from ops.sales_order_line l
    group by l.order_id
),
reservas as (
    -- Sólo las ACTIVAS cuentan: una LIBERADA se soltó y una CONSUMIDA ya se
    -- convirtió en despacho, así que sumarlas contaría dos veces el avance.
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
        min(s.packed_at)                                     as packed_at,
        min(s.shipped_at)                                    as shipped_at,
        max(s.delivered_at)                                  as delivered_at
    from ops.shipment s
    join ops.shipment_line sl on sl.shipment_id = s.id
    where s.status <> 'CANCELADO'
    group by s.order_id
)
select
    so.id                                           as order_id,
    so.code,
    so.currency_code,
    so.created_at,
    so.cancelled_at,
    c.name                                          as cliente,
    o.code                                          as operacion,

    coalesce(l.pedidas, 0)                          as unidades,
    coalesce(l.valor_cents, 0)                      as valor_cents,
    coalesce(r.reservadas, 0)                       as reservadas,
    coalesce(d.alistadas, 0)                        as alistadas,
    coalesce(d.despachadas, 0)                      as despachadas,
    coalesce(d.entregadas, 0)                       as entregadas,

    -- Del estado más avanzado al menos: el primer acierto gana.
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
    end                                             as etapa,

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
    end                                             as etapa_orden,

    -- Días desde el último movimiento REAL. No importa cuándo se creó el
    -- pedido, sino cuánto lleva sin avanzar: eso es lo que delata un atasco.
    extract(day from now() - coalesce(
        d.delivered_at, d.shipped_at, d.packed_at, so.confirmed_at, so.created_at
    ))::int                                         as dias_sin_avanzar

from ops.sales_order so
join ops.customer  c on c.id = so.customer_id
join ops.operation o on o.id = so.operation_id
left join lineas    l on l.order_id = so.id
left join reservas  r on r.order_id = so.id
left join despachos d on d.order_id = so.id;

-- Una fila por etapa: es la consulta del tablero.
create or replace view bi.v_embudo_resumen
with (security_invoker = true) as
select
    operacion,
    etapa,
    etapa_orden,
    count(*)                                        as pedidos,
    sum(unidades)                                   as unidades,
    sum(valor_cents)                                as valor_cents,
    max(dias_sin_avanzar)                           as dias_max_sin_avanzar,
    count(*) filter (where dias_sin_avanzar > 7)    as atascados
from bi.v_embudo
group by operacion, etapa, etapa_orden;

-- -----------------------------------------------------------------------------
-- v_reserva_cuadre — la consulta que hace auditable a `stock.reserved`.
--
-- `reserved` es un acumulado: si algún camino olvida restar, sube para siempre
-- y el disponible se encoge en silencio. Nada falla, nada queda en un log. En
-- seis meses el sistema diría 0 disponible con 40 pares en el estante.
--
-- Esta vista convierte ese misterio en un reporte: cualquier fila con
-- `cuadra = false` es un bug, no una discrepancia aceptable (CLAUDE.md §5).
-- -----------------------------------------------------------------------------
drop view if exists bi.v_reserva_cuadre cascade;

create or replace view bi.v_reserva_cuadre
with (security_invoker = true) as
select
    v.sku,
    w.code                                          as bodega,
    s.qty                                           as fisico,
    s.reserved                                      as reservado_en_stock,
    coalesce(res.activas, 0)                        as reservado_en_reservas,
    s.qty - s.reserved                              as disponible,
    (s.reserved = coalesce(res.activas, 0))         as cuadra
from ops.stock s
join ops.variant   v on v.id = s.variant_id
join ops.warehouse w on w.id = s.warehouse_id
left join (
    select variant_id, warehouse_id, sum(quantity) as activas
    from ops.reservation
    where status = 'ACTIVA'
    group by variant_id, warehouse_id
) res on res.variant_id = s.variant_id and res.warehouse_id = s.warehouse_id;
