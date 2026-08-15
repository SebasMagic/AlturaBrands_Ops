-- =============================================================================
-- Fase 1 — Schema `ops`: el dominio propio
--
-- Nace AL LADO de `public` (las 159 tablas de Medusa), en el mismo proyecto
-- Supabase. Así la migración de datos es `insert … select` entre schemas, los
-- dos mundos conviven mientras se comparan, y no hay big bang ni ventana de
-- corte.
--
-- Idempotente en el sentido útil: se puede tirar entero y recrear mientras
-- estemos en migración (`drop schema ops cascade`). Cuando entre en uso real,
-- los cambios pasan a ser migraciones incrementales del CLI de Supabase.
--
-- -----------------------------------------------------------------------------
-- Decisiones estructurales, y por qué
--
-- 1. FOREIGN KEYS DE VERDAD. En Medusa no existen entre módulos, y por eso los
--    modelos actuales guardan `operation_code`, `brand_code`, `sku` sueltos como
--    claves naturales. Ese workaround aquí sobra: un FK es una columna, no una
--    tabla de enlace, así que ganamos integridad sin pagar joins extra.
--
-- 2. COLUMNAS TIPADAS, NO JSON. Los 9 atributos que vivían en `product.metadata`
--    (material, modelo, genero, color, escala, talla_valor, …) son columnas. Ese
--    JSON existía solo porque no se podían añadir columnas al core de Medusa, y
--    costaba caro: escrito por 6 archivos en 3 lenguajes, sin tipo ni
--    validación, una clave mal escrita devolvía null en silencio.
--
-- 3. IDs `bigint identity`. Legibles al depurar y con buena localidad de índice.
--    Las claves de negocio (`code`, `sku`, `material`) van aparte y con UNIQUE:
--    son las que viajan a reportes, correos y sistemas externos.
--
-- 4. ESTADOS COMO `text` + CHECK, no como enum de Postgres. En un ERP los
--    estados se ajustan; un CHECK se cambia con un ALTER legible y se lee en el
--    propio DDL.
--
-- 5. SIN BORRADO LÓGICO en tablas de hechos. El catálogo usa `is_active` (un
--    producto se descontinúa, no se borra). Los hechos no se borran nunca.
-- =============================================================================

create schema if not exists ops;

-- `updated_at` automático. Trivial pero se olvida en cada tabla si se hace a mano.
create or replace function ops.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =============================================================================
-- CATÁLOGO
-- =============================================================================

-- -----------------------------------------------------------------------------
-- operation — la operación-país. Colombia, Perú, México.
--
-- NO es un tenant: es una sola empresa con operaciones en varios países, y la
-- gerencia necesita consolidar. La separación operativa se resuelve con
-- permisos en la interfaz, no con aislamiento de infraestructura.
-- -----------------------------------------------------------------------------
create table ops.operation (
    id            bigint generated always as identity primary key,
    code          text        not null unique,          -- ISO del país: CO, PE
    name          text        not null,
    currency_code text        not null,                 -- moneda funcional: cop
    is_active     boolean     not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- brand — la marca representada.
--
-- `order_unit` es regla DE LA MARCA, no del negocio ni del producto: KEEN exige
-- bultos cerrados con curva de tallas, otras aceptan pares sueltos. Modelarlo
-- como constante global obligaría a rehacerlo con la segunda marca.
-- -----------------------------------------------------------------------------
create table ops.brand (
    id                bigint generated always as identity primary key,
    code              text        not null unique,      -- KEEN
    name              text        not null,
    order_unit        text        not null default 'PAIR'
                      constraint brand_order_unit_valido check (order_unit in ('PACK','PAIR')),
    -- Solo referencia: la cifra real la fija la curva aplicada, que varía por
    -- modelo (en KEEN se observaron bultos de 8 a 12 pares).
    default_pack_size int,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

-- Qué marcas representa cada operación. Una marca puede estar en varios países.
create table ops.operation_brand (
    operation_id bigint not null references ops.operation(id) on delete cascade,
    brand_id     bigint not null references ops.brand(id)     on delete cascade,
    primary key (operation_id, brand_id)
);

create table ops.category (
    id                 bigint generated always as identity primary key,
    name               text        not null,
    handle             text        not null unique,
    parent_id          bigint      references ops.category(id),
    is_active          boolean     not null default true,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- product — el MATERIAL: modelo + color. El grano con que piensa el negocio.
--
-- No es "el producto" abstracto: es la referencia que se pide, se cuenta y se
-- vende. Las tallas van en `variant`.
--
-- `scale` vive AQUÍ y no en la variante. Se verificó contra los datos: las
-- únicas 90 filas donde diferían eran las variantes fuera de corrida, que
-- simplemente la tenían nula. Duplicarla creaba dos verdades sin aportar nada.
-- -----------------------------------------------------------------------------
create table ops.product (
    id          bigint generated always as identity primary key,

    -- Clave de negocio del archivo maestro de la marca: '1001870'. Es lo que
    -- se cita en pedidos y lo que permite rastrear una fila hasta su origen.
    material    text        not null unique,

    brand_id    bigint      not null references ops.brand(id),
    category_id bigint      references ops.category(id),

    modelo      text        not null,                   -- NEWPORT
    color       text        not null,                   -- BISON
    genero      text        not null                    -- MEN, WOMEN, CHILDREN…
                constraint product_genero_valido
                check (genero in ('MEN','WOMEN','CHILDREN','YOUTH','TOTS')),

    -- Escala de tallas: M, W, C, Y, T. La 8 de CHILDREN y la 8 de MEN son
    -- zapatos distintos; sin esto se sumarían (CLAUDE.md §6).
    scale       text        not null,

    handle      text        not null unique,
    thumbnail_url text,

    -- Dinero en enteros, con la unidad en el nombre (CLAUDE.md §6).
    -- Nulos a propósito: el costeo de importación está en hold por decisión
    -- del negocio, y sin costo nacionalizado cualquier margen sería falso.
    costo_usd_cents             int,
    precio_proveedor_usd_cents  int,

    is_active   boolean     not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index on ops.product (brand_id);
create index on ops.product (category_id);
create index on ops.product (genero);

-- -----------------------------------------------------------------------------
-- variant — una talla de un material.
-- -----------------------------------------------------------------------------
create table ops.variant (
    id          bigint generated always as identity primary key,
    product_id  bigint      not null references ops.product(id) on delete cascade,

    sku         text        not null unique,            -- 1001870-M10.5

    -- Dos representaciones de la talla, a propósito: una para mostrar y otra
    -- para ordenar. Alfabéticamente 'M 10' va antes que 'M 9' (CLAUDE.md §6).
    size_label  text        not null,                   -- 'M 10.5'
    -- numeric(4,1) y NO integer ni float: integer redondea 7.5 a 8 y las
    -- colisiona; float no compara por igualdad de forma confiable.
    size_value  numeric(4,1),

    /**
     * Variante fuera de la corrida: el bucket 'OTRA' donde cae lo que no se
     * pudo asignar a una talla (anchos WIDE, saldos). Se excluye siempre del
     * cálculo de cobertura: incluirla infla el denominador y hace ver el
     * surtido peor de lo que está. Son 90 de 3.064.
     */
    is_off_curve boolean    not null default false,

    -- Código de barras por talla. Vacío hoy: hay 3.106 códigos reales de KEEN
    -- esperando en data/upc-keen.json. Es lo que habilita el lector en bodega.
    upc         text,

    msrp_usd_cents int,

    is_active   boolean     not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    -- Una talla no se repite dentro de un material.
    constraint variant_talla_unica unique (product_id, size_label),
    -- Si está en corrida, tiene valor numérico. Si es OTRA, puede no tenerlo.
    constraint variant_talla_ordenable
        check (is_off_curve or size_value is not null)
);

create index on ops.variant (product_id);


-- =============================================================================
-- INVENTARIO
-- =============================================================================

create table ops.warehouse (
    id           bigint generated always as identity primary key,
    code         text        not null unique,
    name         text        not null,
    operation_id bigint      not null references ops.operation(id),
    is_active    boolean     not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- stock — el saldo. Una fila por (variante, bodega).
--
-- `qty` es lo físico en el estante. `reserved` es lo comprometido pero no
-- despachado. Disponible es la resta, y NO se guarda: un derivado almacenado es
-- una tercera cifra que se desincroniza.
--
-- Los CHECK son la red que impide una sobreventa aunque un camino de código se
-- equivoque (CLAUDE.md §5). La reserva se hace en UNA sentencia atómica:
--
--   update ops.stock set reserved = reserved + $n
--    where variant_id = $v and warehouse_id = $w and qty - reserved >= $n;
--
-- Cero filas devueltas = no había disponible. Postgres serializa solo los
-- update concurrentes sobre la misma fila; no hacen falta locks explícitos.
-- -----------------------------------------------------------------------------
create table ops.stock (
    variant_id   bigint      not null references ops.variant(id)   on delete cascade,
    warehouse_id bigint      not null references ops.warehouse(id) on delete cascade,
    qty          int         not null default 0,
    reserved     int         not null default 0,
    updated_at   timestamptz not null default now(),

    primary key (variant_id, warehouse_id),
    constraint stock_qty_no_negativo      check (qty >= 0),
    constraint stock_reserva_no_negativa  check (reserved >= 0),
    constraint stock_sin_sobreventa       check (reserved <= qty)
);

create index on ops.stock (warehouse_id);

-- -----------------------------------------------------------------------------
-- stock_move — el kardex. Registro inmutable de TODA variación de existencias.
--
-- Sin esto no se puede responder "¿por qué esta talla tiene 3 y no 5?", que es
-- lo que separa un inventario auditable de una cifra en la que hay que creer.
--
-- Regla: el saldo debe poder reconstruirse sumando los movimientos. Si no
-- cuadra, hay un camino que se saltó las reglas — eso es un bug, no una
-- discrepancia aceptable.
--
-- Nada se edita ni se borra. Un error se corrige con un movimiento contrario,
-- igual que en contabilidad.
-- -----------------------------------------------------------------------------
create table ops.stock_move (
    id             bigint generated always as identity primary key,
    variant_id     bigint      not null references ops.variant(id),
    warehouse_id   bigint      not null references ops.warehouse(id),

    -- El signo va en `quantity`, no en el tipo: así un sum() sobre el kardex da
    -- el saldo sin un solo CASE.
    kind           text        not null
                   constraint stock_move_kind_valido check (kind in (
                       'RECEIPT',      -- recepción de mercancía comprada
                       'SALE',         -- salida por venta
                       'ADJUSTMENT',   -- ajuste por conteo físico
                       'TRANSFER_IN',
                       'TRANSFER_OUT',
                       'RETURN'
                   )),
    quantity       int         not null                 -- positiva entra, negativa sale
                   constraint stock_move_sin_ceros check (quantity <> 0),

    -- Documento que lo originó. Permite reconstruir el porqué sin salir de aquí.
    reference_type text        not null,
    reference_id   text        not null,

    -- Saldo tras aplicar el movimiento. Redundante a propósito: deja detectar
    -- en una sola consulta si el kardex y el saldo divergieron, sin recalcular
    -- toda la historia.
    balance_after  int,

    notes          text,
    created_by     text,
    created_at     timestamptz not null default now()
);

create index on ops.stock_move (variant_id, warehouse_id, created_at desc);
create index on ops.stock_move (reference_type, reference_id);


-- =============================================================================
-- ABASTECIMIENTO
-- =============================================================================

-- -----------------------------------------------------------------------------
-- supply_availability — mercancía que TODAVÍA NO es nuestra.
--
-- Separado de `stock` deliberadamente: estas unidades no se pueden reservar ni
-- despachar. Si vivieran como saldo, un vendedor podría comprometer los 113.447
-- pares que están en la bodega del proveedor en Estados Unidos.
-- -----------------------------------------------------------------------------
create table ops.supply_availability (
    id           bigint generated always as identity primary key,
    variant_id   bigint      not null references ops.variant(id) on delete cascade,
    operation_id bigint      not null references ops.operation(id),

    -- Nombre tal cual viene del archivo maestro: 'ATS USA', 'Transito (60
    -- dias)'. No se normaliza para no perder trazabilidad al origen.
    source       text        not null,

    kind         text        not null
                 constraint supply_kind_valido check (kind in (
                     'SUPPLIER',    -- disponible en la marca; requiere orden de compra
                     'IN_TRANSIT'   -- ya comprado, aún no recibido
                 )),

    -- Días estimados hasta recepción. Nulo para SUPPLIER, que no tiene fecha
    -- comprometida mientras no exista una orden de compra.
    eta_days     int,
    quantity     int         not null check (quantity >= 0),

    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),

    constraint supply_eta_solo_en_transito
        check (kind = 'IN_TRANSIT' or eta_days is null)
);

create index on ops.supply_availability (variant_id);
create index on ops.supply_availability (operation_id, kind);

-- -----------------------------------------------------------------------------
-- size_curve — cómo se reparte un bulto entre las tallas de una corrida.
--
-- En calzado mayorista no se piden pares sueltos sino bultos, y cada bulto trae
-- una distribución fija: más pares de las tallas centrales, menos de los
-- extremos. `bultos × curva = cantidades`.
--
-- La curva NO es del producto ni una constante: es una regla que el equipo
-- define y ajusta según el mercado. Por eso es entidad propia y editable.
-- -----------------------------------------------------------------------------
create table ops.size_curve (
    id             bigint generated always as identity primary key,
    code           text        not null unique,
    brand_id       bigint      not null references ops.brand(id),
    name           text        not null,
    -- Una curva de MEN no puede aplicarse a CHILDREN aunque compartan números.
    scale          text        not null,
    -- Suma de las proporciones. Derivado, se guarda para no recalcularlo.
    pairs_per_pack int         not null,
    is_default     boolean     not null default false,
    is_active      boolean     not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create table ops.size_curve_entry (
    id         bigint generated always as identity primary key,
    curve_id   bigint        not null references ops.size_curve(id) on delete cascade,
    size_label text          not null,
    size_value numeric(4,1)  not null,
    ratio      int           not null check (ratio >= 0),   -- pares por bulto

    constraint curva_talla_unica unique (curve_id, size_label)
);

-- -----------------------------------------------------------------------------
-- purchase_order — pedido a la marca.
--
-- Tres niveles y no dos: cabecera, ítem por material y detalle por talla. El
-- tercero existe porque hay que comparar LO PEDIDO contra LO CONFIRMADO talla a
-- talla — la marca ajusta según su disponibilidad real. Ese desglose en un JSON
-- sería inconsultable desde BI.
-- -----------------------------------------------------------------------------
create table ops.purchase_order (
    id              bigint generated always as identity primary key,
    code            text        not null unique,        -- PO-CO-KEEN-0001
    operation_id    bigint      not null references ops.operation(id),
    brand_id        bigint      not null references ops.brand(id),

    status          text        not null default 'DRAFT'
                    constraint po_status_valido check (status in (
                        'DRAFT',           -- montado, se edita libremente
                        'QTY_CHECKED',     -- la marca revisó y ajustó cantidades
                        'CLIENT_APPROVED', -- aprobado, ya no se toca
                        'DISPATCHED',      -- despachado; alimenta tránsito
                        'CANCELLED'
                    )),

    -- Moneda de compra. No es la de la operación: se compra en USD y se vende
    -- en pesos.
    currency_code   text        not null,
    notes           text,

    -- Una marca de tiempo por transición, no solo `updated_at`: la diferencia
    -- entre ellas es el lead time real por tramo, que es lo que permite
    -- prometer entregas con fundamento.
    placed_at       timestamptz,
    qty_checked_at  timestamptz,
    approved_at     timestamptz,
    dispatched_at   timestamptz,
    dispatch_ticket text,                                -- comprobante de la marca

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table ops.purchase_order_item (
    id              bigint generated always as identity primary key,
    order_id        bigint      not null references ops.purchase_order(id) on delete cascade,
    product_id      bigint      not null references ops.product(id),
    description     text        not null,

    -- Curva aplicada y bultos pedidos: juntos reproducen las cantidades.
    size_curve_id   bigint      references ops.size_curve(id),
    packs           int         not null default 0,

    -- Se guarda la curva MÁS el ajuste, no una curva inventada: así queda
    -- registrado "usó KEEN-M-01 y quitó la 10.5", que responde preguntas de
    -- negocio. Guardar solo el resultado final pierde el porqué.
    is_adjusted     boolean     not null default false,
    adjustment_note text,

    unit_cost_cents int,

    constraint po_item_material_unico unique (order_id, product_id)
);

create table ops.purchase_order_size (
    id                 bigint generated always as identity primary key,
    item_id            bigint not null references ops.purchase_order_item(id) on delete cascade,
    variant_id         bigint not null references ops.variant(id),

    quantity_requested int    not null default 0 check (quantity_requested >= 0),

    -- NULO hasta que la marca revise. Distinto de cero, que significa "revisado
    -- y no hay". Esa diferencia es la que sustenta un reclamo.
    quantity_confirmed int    check (quantity_confirmed >= 0),

    constraint po_size_variante_unica unique (item_id, variant_id)
);

-- -----------------------------------------------------------------------------
-- goods_receipt — el paso que convierte tránsito en existencias.
--
-- Recepciones PARCIALES son la norma: un contenedor rara vez llega completo, y
-- forzar un todo-o-nada obligaría a mentir en el conteo para poder cerrarlo.
--
-- Una recepción confirmada NO se edita. Un error se corrige con un ajuste de
-- inventario, que deja su propio rastro en el kardex.
-- -----------------------------------------------------------------------------
create table ops.goods_receipt (
    id                bigint generated always as identity primary key,
    code              text        not null unique,
    operation_id      bigint      not null references ops.operation(id),
    purchase_order_id bigint      references ops.purchase_order(id),
    warehouse_id      bigint      not null references ops.warehouse(id),

    status            text        not null default 'DRAFT'
                      constraint receipt_status_valido check (status in (
                          'DRAFT',      -- contando; no ha tocado el inventario
                          'CONFIRMED',  -- aplicada; el stock se movió y el kardex está escrito
                          'CANCELLED'
                      )),

    -- Referencia física: contenedor, guía o remisión. Es lo que ata la
    -- recepción al papel cuando algo no cuadra.
    reference         text,
    received_at       timestamptz,
    confirmed_at      timestamptz,
    received_by       text,
    notes             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create table ops.goods_receipt_line (
    id                bigint not null generated always as identity primary key,
    receipt_id        bigint not null references ops.goods_receipt(id) on delete cascade,
    variant_id        bigint not null references ops.variant(id),

    -- Lo que la marca dijo que despachaba, traído de la orden de compra.
    quantity_expected int    not null check (quantity_expected >= 0),

    -- Lo que de verdad se contó al abrir la caja. NULO es "aún no contado",
    -- cero es "contado y no vino nada". No es lo mismo un faltante confirmado
    -- que un conteo pendiente.
    quantity_received int    check (quantity_received >= 0),

    discrepancy_note  text,

    constraint receipt_variante_unica unique (receipt_id, variant_id)
);


-- =============================================================================
-- Triggers de updated_at
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'operation','brand','category','product','variant','warehouse','stock',
    'supply_availability','size_curve','purchase_order','goods_receipt'
  ] loop
    execute format(
      'create trigger %I_touch before update on ops.%I
         for each row execute function ops.touch_updated_at()', t, t);
  end loop;
end $$;


-- =============================================================================
-- RLS
--
-- Se activa en todo. La aplicación accede desde el servidor con la clave de
-- servicio, que hace bypass, así que esto NO es la línea principal de defensa
-- —lo es la autorización en el servidor— sino la red que atrapa una tabla
-- expuesta por accidente a la Data API.
--
-- Sin políticas, el acceso anónimo queda denegado por defecto, que es lo que
-- queremos hoy. Las políticas se escriben cuando exista acceso desde el
-- navegador, no antes (CLAUDE.md §4).
-- =============================================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'ops' loop
    execute format('alter table ops.%I enable row level security', t);
  end loop;
end $$;
