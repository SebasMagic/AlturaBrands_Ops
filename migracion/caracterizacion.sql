-- =============================================================================
-- Test de caracterización — Fase 0 de la migración a schema propio
--
-- Congela lo que HOY es correcto sobre la capa `bi`, para poder afirmar que el
-- esquema nuevo quedó bien. No es sólo una red de seguridad: es la
-- ESPECIFICACIÓN ejecutable de las vistas que hay que reescribir.
--
-- Por qué se escribe contra `bi.*` y no contra las tablas: los nombres de las
-- vistas y sus columnas de salida NO cambian entre Medusa y `ops`. Sólo cambia
-- de dónde leen. Así este archivo no se toca en toda la migración — pasa hoy,
-- y tiene que volver a pasar en la Fase 3 sin editar una línea. Si hay que
-- cambiarlo para que pase, algo se rompió de verdad.
--
-- Corre en cualquier cliente SQL (editor de Supabase, psql) o vía
-- `node migracion/verificar.mjs`, que además devuelve código de salida.
--
-- Dos clases de chequeo:
--   · Valor fijo   — cifras verificadas contra la base el 14 ago 2026.
--   · Conservación — compara dos vistas entre sí en vez de contra un literal.
--     Siguen siendo válidos aunque entren datos nuevos, y son los que atrapan
--     un join que duplica o pierde filas al reescribir.
-- =============================================================================

with resultados(orden, grupo, chequeo, esperado, obtenido) as (

  -- --- Totales de posición -------------------------------------------------
  select 1, 'Posición', 'Filas (variante × operación)', 3064::bigint,
         (select count(*) from bi.v_posicion)
  union all select 2, 'Posición', 'Materiales distintos', 334,
         (select count(distinct material) from bi.v_posicion)
  union all select 3, 'Posición', 'Pares en bodega', 278,
         (select sum(propio)::bigint from bi.v_posicion)
  union all select 4, 'Posición', 'Pares reservados', 0,
         (select sum(reservado)::bigint from bi.v_posicion)
  union all select 5, 'Posición', 'Pares en tránsito', 10280,
         (select sum(en_transito)::bigint from bi.v_posicion)
  union all select 6, 'Posición', 'Pares por pedir en la marca', 113447,
         (select sum(en_proveedor)::bigint from bi.v_posicion)

  -- --- Dimensiones ---------------------------------------------------------
  union all select 7, 'Dimensiones', 'Escalas de talla', 5,
         (select count(distinct escala) from bi.v_posicion)
  union all select 8, 'Dimensiones', 'Géneros', 5,
         (select count(distinct genero) from bi.v_posicion)
  union all select 9, 'Dimensiones', 'Categorías', 6,
         (select count(distinct categoria) from bi.v_posicion)
  union all select 10, 'Dimensiones', 'Marcas', 1,
         (select count(distinct marca) from bi.v_posicion)

  -- --- Conservación entre capas --------------------------------------------
  -- Las tres naturalezas viajan de los hechos a la posición sin perderse ni
  -- duplicarse. Si un join del esquema nuevo multiplica filas, revienta aquí
  -- antes de que nadie mire una pantalla.
  union all select 11, 'Conservación', 'Bodega: fact_stock = v_posicion',
         (select sum(en_bodega)::bigint from bi.fact_stock),
         (select sum(propio)::bigint from bi.v_posicion)
  union all select 12, 'Conservación', 'Tránsito: fact_supply = v_posicion',
         (select sum(unidades)::bigint from bi.fact_supply where tipo = 'IN_TRANSIT'),
         (select sum(en_transito)::bigint from bi.v_posicion)
  union all select 13, 'Conservación', 'Por pedir: fact_supply = v_posicion',
         (select sum(unidades)::bigint from bi.fact_supply where tipo = 'SUPPLIER'),
         (select sum(en_proveedor)::bigint from bi.v_posicion)

  -- --- Material canónico: NEWPORT · BISON (1001870) -------------------------
  -- Se eligió porque es el único caso que ejercita las tres naturalezas a la
  -- vez y además tiene la corrida rota: 10 pares apilados en 3 tallas de 12.
  union all select 20, 'NEWPORT · BISON', 'Tallas en corrida (sin OTRA)', 12,
         (select tallas_en_corrida::bigint from bi.v_cobertura_corrida where material = '1001870')
  union all select 21, 'NEWPORT · BISON', 'Tallas con stock propio', 3,
         (select tallas_con_propio::bigint from bi.v_cobertura_corrida where material = '1001870')
  union all select 22, 'NEWPORT · BISON', 'Tallas con disponibilidad (con OTRA)', 13,
         (select tallas_en_proveedor::bigint from bi.v_cobertura_corrida where material = '1001870')
  union all select 23, 'NEWPORT · BISON', 'Pares en bodega', 10,
         (select propio::bigint from bi.v_cobertura_corrida where material = '1001870')
  union all select 24, 'NEWPORT · BISON', 'Pares en tránsito', 72,
         (select en_transito::bigint from bi.v_cobertura_corrida where material = '1001870')
  union all select 25, 'NEWPORT · BISON', 'Pares por pedir', 588,
         (select en_proveedor::bigint from bi.v_cobertura_corrida where material = '1001870')

  -- --- Reglas de dominio (CLAUDE.md §6) ------------------------------------
  union all select 30, 'Reglas', 'Variantes fuera de corrida (OTRA)', 90,
         (select count(*) from bi.v_posicion where pendiente_desglose)
  -- Toda talla real tiene valor numérico para ordenar. Sin esto 'M 10' se
  -- ordena antes que 'M 9' y la corrida se lee mal.
  union all select 31, 'Reglas', 'Tallas de corrida sin valor numérico', 0,
         (select count(*) from bi.v_posicion where talla_valor is null and not pendiente_desglose)
  union all select 32, 'Reglas', 'Materiales sin marca', 0,
         (select count(*) from bi.v_posicion where marca is null)

  -- --- Curvas de tallas ----------------------------------------------------
  union all select 40, 'Curvas', 'Curvas activas', 7,
         (select count(*) from bi.v_curvas)
  union all select 41, 'Curvas', 'Curvas con huecos', 0,
         (select count(*) from bi.v_curvas where tiene_huecos)
  union all select 42, 'Curvas', 'Entradas de curva', 51,
         (select count(*) from bi.v_curva_detalle)

  -- --- Volúmenes del resto de la capa --------------------------------------
  union all select 50, 'Volúmenes', 'Niveles de stock (fact_stock)', 702,
         (select count(*) from bi.fact_stock)
  union all select 51, 'Volúmenes', 'Filas de abastecimiento (fact_supply)', 3301,
         (select count(*) from bi.fact_supply)
  union all select 52, 'Volúmenes', 'Operaciones', 1,
         (select count(*) from bi.dim_operation)
  union all select 53, 'Volúmenes', 'Resumen por talla', 43,
         (select count(*) from bi.v_resumen_talla)
  union all select 54, 'Volúmenes', 'Valorización', 30,
         (select count(*) from bi.v_valorizacion)
  -- Cero a propósito: no existe un solo pedido de venta. Cuando la Fase 5
  -- entre en uso este chequeo hay que actualizarlo — y que falle es la señal
  -- de que el embudo por fin tiene datos.
  union all select 55, 'Volúmenes', 'Pedidos en el embudo', 0,
         (select count(*) from bi.v_embudo)
)
select
    grupo,
    chequeo,
    esperado,
    obtenido,
    case when obtenido is not distinct from esperado then 'OK' else 'FALLA' end as estado
from resultados
order by orden;
