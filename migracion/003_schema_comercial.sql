-- =============================================================================
-- Fase 5 — Comercial: clientes, cotización → pedido, reservas y despacho
--
-- Es lo que NO existía en Medusa a pesar de tener 159 tablas para ello: cero
-- órdenes, cero clientes, cero reservas, cero despachos en toda la vida del
-- proyecto. Por eso se diseña aquí desde cero y a la medida, en vez de heredar
-- el modelo de un motor de e-commerce.
--
-- -----------------------------------------------------------------------------
-- Decisiones, y por qué
--
-- 1. `sales_order`, NO `order`. `order` es palabra reservada en SQL y obligaría
--    a escribir `ops."order"` en cada consulta y cada vista, para siempre. El
--    contrato decía `ops.order`; se cambia deliberadamente porque el costo de
--    las comillas es permanente y el de renombrar es cero hoy.
--
-- 2. LA COTIZACIÓN NO ES OTRA TABLA. Es el mismo documento en estado
--    COTIZACION. Separarlas obligaría a copiar líneas al confirmar, y esa copia
--    es donde se pierde el rastro de qué se cotizó realmente.
--
-- 3. LA ETAPA DEL EMBUDO NO SE GUARDA. Se deriva por cantidades (CLAUDE.md §6).
--    Sólo se guarda lo que es un hecho: se reservó, se empacó, se despachó, se
--    entregó. La etapa es una lectura de esos hechos.
--
-- 4. RESERVA CON TABLA PROPIA, no sólo el contador en `ops.stock`. `reserved`
--    es un acumulado: si un camino olvida restar, sube para siempre y el
--    disponible se encoge en silencio. Con esta tabla, `stock.reserved` se
--    cuadra contra `sum(reservation.qty)` con una consulta (CLAUDE.md §5).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- customer
-- -----------------------------------------------------------------------------
create table ops.customer (
    id           bigint generated always as identity primary key,
    code         text        not null unique,          -- NIT o código interno
    name         text        not null,
    tax_id       text,                                 -- NIT/RUT para facturar
    email        text,
    phone        text,
    city         text,
    operation_id bigint      not null references ops.operation(id),
    is_active    boolean     not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index on ops.customer (operation_id);

-- -----------------------------------------------------------------------------
-- sales_order — cotización y pedido son el MISMO documento.
--
-- Las marcas de tiempo por transición existen por la misma razón que en
-- `purchase_order`: la diferencia entre ellas es el lead time real por tramo, y
-- sólo con `updated_at` sería imposible reconstruirlo.
-- -----------------------------------------------------------------------------
create table ops.sales_order (
    id            bigint generated always as identity primary key,
    code          text        not null unique,          -- SO-CO-0001
    operation_id  bigint      not null references ops.operation(id),
    customer_id   bigint      not null references ops.customer(id),
    -- Desde qué bodega se compromete y se despacha. La reserva es POR BODEGA:
    -- reservar "5 pares" en abstracto no se puede alistar.
    warehouse_id  bigint      not null references ops.warehouse(id),

    status        text        not null default 'COTIZACION'
                  constraint so_status_valido check (status in (
                      'COTIZACION',  -- propuesta; no compromete inventario
                      'CONFIRMADO',  -- pedido en firme; ya puede reservar
                      'CANCELADO'
                  )),

    currency_code text        not null,
    notes         text,

    quoted_at     timestamptz,
    confirmed_at  timestamptz,
    cancelled_at  timestamptz,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index on ops.sales_order (operation_id, status);
create index on ops.sales_order (customer_id);

create table ops.sales_order_line (
    id               bigint generated always as identity primary key,
    order_id         bigint not null references ops.sales_order(id) on delete cascade,
    variant_id       bigint not null references ops.variant(id),

    quantity         int    not null check (quantity > 0),
    -- Dinero en enteros con la unidad en el nombre (CLAUDE.md §6). En COP, que
    -- es la moneda de la operación: se compra en USD y se vende en pesos.
    unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),

    constraint so_line_variante_unica unique (order_id, variant_id)
);

create index on ops.sales_order_line (variant_id);

-- -----------------------------------------------------------------------------
-- reservation — lo comprometido y no despachado.
--
-- Existe para que `ops.stock.reserved` sea AUDITABLE en vez de un número en el
-- que hay que creer. La invariante que hay que poder verificar en una consulta:
--
--   sum(reservation.quantity) filter (status = 'ACTIVA')  ==  stock.reserved
--
-- Estados: ACTIVA cuenta contra el disponible. LIBERADA se soltó sin despachar
-- (cancelación). CONSUMIDA se convirtió en despacho — ahí `reserved` baja y
-- `qty` también, porque la mercancía salió.
-- -----------------------------------------------------------------------------
create table ops.reservation (
    id            bigint generated always as identity primary key,
    order_line_id bigint      not null references ops.sales_order_line(id) on delete cascade,
    variant_id    bigint      not null references ops.variant(id),
    warehouse_id  bigint      not null references ops.warehouse(id),
    quantity      int         not null check (quantity > 0),

    status        text        not null default 'ACTIVA'
                  constraint reserva_status_valido check (status in ('ACTIVA','LIBERADA','CONSUMIDA')),

    created_at    timestamptz not null default now(),
    released_at   timestamptz
);

create index on ops.reservation (variant_id, warehouse_id) where status = 'ACTIVA';
create index on ops.reservation (order_line_id);

-- -----------------------------------------------------------------------------
-- shipment — el despacho.
--
-- Despachos PARCIALES son la norma, igual que las recepciones: rara vez sale
-- todo junto. Por eso el embudo se calcula por cantidades y no por fechas — un
-- pedido con 90 de 100 pares despachados no está despachado, está a medias, y
-- esa distinción es justo la que el coordinador necesita ver.
-- -----------------------------------------------------------------------------
create table ops.shipment (
    id           bigint generated always as identity primary key,
    code         text        not null unique,           -- SH-CO-0001
    order_id     bigint      not null references ops.sales_order(id),
    warehouse_id bigint      not null references ops.warehouse(id),

    status       text        not null default 'ALISTANDO'
                 constraint shipment_status_valido check (status in (
                     'ALISTANDO',  -- se está recogiendo de las estanterías
                     'EMPACADO',   -- listo, aún no sale
                     'DESPACHADO', -- salió; el stock ya se descontó
                     'ENTREGADO',
                     'CANCELADO'
                 )),

    tracking     text,                                  -- guía del transportador
    packed_at    timestamptz,
    shipped_at   timestamptz,
    delivered_at timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index on ops.shipment (order_id);

create table ops.shipment_line (
    id            bigint not null generated always as identity primary key,
    shipment_id   bigint not null references ops.shipment(id) on delete cascade,
    order_line_id bigint not null references ops.sales_order_line(id),
    variant_id    bigint not null references ops.variant(id),
    quantity      int    not null check (quantity > 0),

    constraint shipment_linea_unica unique (shipment_id, order_line_id)
);

-- =============================================================================
-- Triggers de updated_at, sobre las tablas nuevas
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['customer','sales_order','shipment'] loop
    execute format(
      'create trigger %I_touch before update on ops.%I
         for each row execute function ops.touch_updated_at()', t, t);
  end loop;
end $$;

-- =============================================================================
-- RLS en las tablas nuevas — misma razón que en 001: la app entra por el
-- servidor, esto es la red por si alguna queda expuesta a la Data API.
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'customer','sales_order','sales_order_line','reservation','shipment','shipment_line'
  ] loop
    execute format('alter table ops.%I enable row level security', t);
  end loop;
end $$;
