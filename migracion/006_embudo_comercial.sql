-- =============================================================================
-- Embudo comercial: la etapa que SÍ se guarda
--
-- Convive con `bi.v_embudo` (ahora la pantalla de Operaciones), y son cosas
-- distintas a propósito:
--
--   OPERACIONES  la etapa se DERIVA de hechos: hay reservas, hay empaque, hay
--                despacho. Guardarla crearía una segunda verdad que se
--                desincroniza en cuanto alguien despacha por otra vía
--                (CLAUDE.md §6).
--
--   COMERCIAL    la etapa es un JUICIO del vendedor: "está evaluando",
--                "estamos negociando". No hay ningún hecho en la base del que
--                se pueda deducir. Si no se guarda, no existe.
--
-- Por eso una se calcula y la otra es una columna, y por eso sólo esta se
-- puede arrastrar en un tablero.
-- =============================================================================

alter table ops.sales_order
  add column if not exists etapa_comercial text not null default 'PROSPECTO';

-- Se añade aparte del `add column` para poder reejecutar el archivo.
alter table ops.sales_order drop constraint if exists so_etapa_comercial_valida;
alter table ops.sales_order add constraint so_etapa_comercial_valida
  check (etapa_comercial in (
      'PROSPECTO',    -- hay interés, todavía no hay números
      'COTIZADO',     -- se envió la cotización
      'NEGOCIACION',  -- discutiendo precio, cantidades o plazos
      'GANADO',       -- aceptó; el pedido pasa a firme
      'PERDIDO'       -- no se cerró
  ));

/**
 * Orden dentro de la columna del tablero.
 *
 * Existe para que arrastrar una tarjeta ARRIBA de otra signifique algo — sin
 * esto el orden lo decidiría la fecha y el vendedor no podría priorizar. Se
 * usa un entero con huecos (100, 200, 300…) para poder insertar en medio sin
 * reescribir toda la columna.
 */
alter table ops.sales_order
  add column if not exists orden_tablero int not null default 0;

create index if not exists sales_order_embudo
  on ops.sales_order (operation_id, etapa_comercial, orden_tablero);

-- Los pedidos que ya existían nacen coherentes con su estado, no todos en
-- PROSPECTO: uno confirmado evidentemente se ganó.
update ops.sales_order
   set etapa_comercial = case
         when status = 'CONFIRMADO' then 'GANADO'
         when status = 'CANCELADO'  then 'PERDIDO'
         else 'COTIZADO'
       end
 where etapa_comercial = 'PROSPECTO';
