-- =============================================================================
-- Proforma: descuentos por línea y a pie de documento
--
-- La pantalla de cotización pasa a ser una proforma. Eso exige dos cosas que
-- el modelo no tenía: descuento por ítem y descuento global.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ SE GUARDA EL PORCENTAJE Y NO EL IMPORTE
--
-- Podría guardarse el importe descontado ya calculado, pero entonces habría
-- dos cifras que pueden divergir (el % que se pactó y los pesos que se
-- restaron). Se guarda SOLO el porcentaje, y el importe se calcula siempre con
-- la misma función pura (`lib/domain/proforma.ts`).
--
-- Es determinista porque `unit_price_cents` queda CONGELADO en la línea al
-- cotizar: aunque mañana cambie el precio del producto, esta proforma sigue
-- dando exactamente el mismo total. Sin ese congelado, recalcular sería
-- peligroso y habría que guardar el importe.
-- =============================================================================

-- Descuento por ítem: el que se negocia línea a línea.
alter table ops.sales_order_line
  add column if not exists discount_pct numeric(5,2) not null default 0;

alter table ops.sales_order_line drop constraint if exists so_line_descuento_valido;
alter table ops.sales_order_line add constraint so_line_descuento_valido
  check (discount_pct >= 0 and discount_pct <= 100);

-- Descuento a pie de documento: el que se da sobre el total ya sumado.
-- Es OTRO descuento, no un sustituto del anterior: en la práctica se negocian
-- por separado ("te bajo un 5% en las botas y un 3% más al cierre").
alter table ops.sales_order
  add column if not exists discount_pct numeric(5,2) not null default 0;

alter table ops.sales_order drop constraint if exists so_descuento_valido;
alter table ops.sales_order add constraint so_descuento_valido
  check (discount_pct >= 0 and discount_pct <= 100);

-- Validez de la proforma. Una cotización sin fecha de caducidad obliga a
-- respetar precios de hace seis meses, y en importación eso duele.
alter table ops.sales_order
  add column if not exists valid_until date;
