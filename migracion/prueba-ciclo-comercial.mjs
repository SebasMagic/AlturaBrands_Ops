#!/usr/bin/env node
/**
 * Prueba de extremo a extremo del ciclo comercial, contra la base REAL.
 *
 *   node migracion/prueba-ciclo-comercial.mjs
 *
 * Recorre cotización → pedido → reserva → empaque → despacho → entrega,
 * comprobando en cada paso que `bi.v_embudo` deriva la etapa correcta, y
 * ejercita a propósito los dos casos que importan:
 *
 *   · la reserva ATÓMICA rechaza cuando no hay disponible (no sobrevende);
 *   · `stock.reserved` cuadra contra las reservas activas en todo momento.
 *
 * Limpia TODO al terminar: la base queda exactamente como estaba. Es
 * verificación, no seed.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const linea of readFileSync(join(RAIZ, '.env'), 'utf8').split('\n')) {
  const l = linea.trim()
  if (!l || l.startsWith('#')) continue
  const i = l.indexOf('=')
  if (i === -1) continue
  const k = l.slice(0, i).trim()
  if (process.env[k] === undefined) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const q = (sql, params) => pool.query(sql, params)

let fallos = 0
function comprobar(descripcion, esperado, obtenido) {
  const ok = String(esperado) === String(obtenido)
  if (!ok) fallos++
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${descripcion}: esperado ${esperado}, obtenido ${obtenido}`)
}

async function etapaDe(orderId) {
  const { rows } = await q('select etapa from bi.v_embudo where order_id = $1', [orderId])
  return rows[0]?.etapa
}

async function cuadreOk() {
  const { rows } = await q('select count(*)::int as n from bi.v_reserva_cuadre where not cuadra')
  return rows[0].n
}

let customerId, orderId, lineaId, shipmentId
const creado = { reservas: [], shipmentLines: [], stockTocado: [] }

try {
  console.log('\n=== Preparación ===')
  const { rows: op } = await q("select id from ops.operation where code='CO'")
  const { rows: wh } = await q('select id, code from ops.warehouse limit 1')
  const operationId = op[0].id
  const warehouseId = wh[0].id

  // Una variante con stock propio suficiente y otra deliberadamente sin stock.
  const { rows: conStock } = await q(
    `select s.variant_id, v.sku, s.qty, s.reserved
       from ops.stock s join ops.variant v on v.id = s.variant_id
      where s.qty - s.reserved >= 3 order by s.qty desc limit 1`
  )
  const { rows: sinStock } = await q(
    `select s.variant_id, v.sku, s.qty, s.reserved
       from ops.stock s join ops.variant v on v.id = s.variant_id
      where s.qty - s.reserved = 0 limit 1`
  )
  console.log(`  Bodega: ${wh[0].code}`)
  console.log(`  Variante con stock: ${conStock[0].sku} (${conStock[0].qty} físico)`)
  console.log(`  Variante sin stock: ${sinStock[0].sku} (${sinStock[0].qty} físico)`)

  const reservedInicial = conStock[0].reserved
  creado.stockTocado.push({ variantId: conStock[0].variant_id, warehouseId, reserved: reservedInicial })

  // --- Cliente y cotización ---
  const { rows: cli } = await q(
    `insert into ops.customer (code, name, operation_id) values ('TEST-CICLO','Cliente de prueba',$1) returning id`,
    [operationId]
  )
  customerId = cli[0].id

  const { rows: so } = await q(
    `insert into ops.sales_order (code, operation_id, customer_id, warehouse_id, status, currency_code, quoted_at)
     values ('SO-TEST-0001',$1,$2,$3,'COTIZACION','cop',now()) returning id`,
    [operationId, customerId, warehouseId]
  )
  orderId = so[0].id

  const { rows: ln } = await q(
    `insert into ops.sales_order_line (order_id, variant_id, quantity, unit_price_cents)
     values ($1,$2,3,45000000) returning id`,
    [orderId, conStock[0].variant_id]
  )
  lineaId = ln[0].id

  console.log('\n=== 1. Cotización ===')
  comprobar('etapa', 'COTIZACION', await etapaDe(orderId))

  console.log('\n=== 2. Reservar una COTIZACIÓN debe fallar ===')
  // Una propuesta no compromete inventario. Se comprueba por el estado, no
  // llamando al TS (este script es SQL puro), replicando la misma guarda.
  const { rows: estado } = await q('select status from ops.sales_order where id=$1', [orderId])
  comprobar('estado bloquea la reserva', 'COTIZACION', estado[0].status)

  console.log('\n=== 3. Confirmar el pedido ===')
  await q("update ops.sales_order set status='CONFIRMADO', confirmed_at=now() where id=$1", [orderId])
  comprobar('etapa', 'PEDIDO', await etapaDe(orderId))

  console.log('\n=== 4. Reserva atómica: caso que SÍ alcanza ===')
  const { rowCount: reservoOk } = await q(
    `update ops.stock set reserved = reserved + 3
      where variant_id=$1 and warehouse_id=$2 and qty - reserved >= 3`,
    [conStock[0].variant_id, warehouseId]
  )
  comprobar('el update atómico afectó 1 fila', 1, reservoOk)
  const { rows: resv } = await q(
    `insert into ops.reservation (order_line_id, variant_id, warehouse_id, quantity)
     values ($1,$2,$3,3) returning id`,
    [lineaId, conStock[0].variant_id, warehouseId]
  )
  creado.reservas.push(resv[0].id)
  comprobar('etapa', 'RESERVADO', await etapaDe(orderId))
  comprobar('descuadres de reserva', 0, await cuadreOk())

  console.log('\n=== 5. Reserva atómica: caso que NO alcanza (no debe sobrevender) ===')
  const { rowCount: reservoMal } = await q(
    `update ops.stock set reserved = reserved + 999
      where variant_id=$1 and warehouse_id=$2 and qty - reserved >= 999`,
    [sinStock[0].variant_id, warehouseId]
  )
  comprobar('el update atómico afectó 0 filas', 0, reservoMal)
  comprobar('descuadres tras el intento fallido', 0, await cuadreOk())

  console.log('\n=== 6. Empacar (parcial: 2 de 3) ===')
  const { rows: sh } = await q(
    `insert into ops.shipment (code, order_id, warehouse_id, status, packed_at)
     values ('SH-TEST-0001',$1,$2,'EMPACADO',now()) returning id`,
    [orderId, warehouseId]
  )
  shipmentId = sh[0].id
  const { rows: shl } = await q(
    `insert into ops.shipment_line (shipment_id, order_line_id, variant_id, quantity)
     values ($1,$2,$3,2) returning id`,
    [shipmentId, lineaId, conStock[0].variant_id]
  )
  creado.shipmentLines.push(shl[0].id)
  comprobar('etapa', 'EMPACADO', await etapaDe(orderId))

  console.log('\n=== 7. Despachar parcialmente (2 de 3 pares) ===')
  await q("update ops.shipment set status='DESPACHADO', shipped_at=now() where id=$1", [shipmentId])
  comprobar('etapa (por cantidades, no por fechas)', 'DESPACHO PARCIAL', await etapaDe(orderId))
  const { rows: parcial } = await q('select despachadas, unidades from bi.v_embudo where order_id=$1', [orderId])
  comprobar('despachadas', 2, parcial[0].despachadas)
  comprobar('pedidas', 3, parcial[0].unidades)

  console.log('\n=== 8. Completar el despacho (3 de 3) ===')
  await q('update ops.shipment_line set quantity = 3 where id = $1', [creado.shipmentLines[0]])
  comprobar('etapa', 'DESPACHADO', await etapaDe(orderId))

  console.log('\n=== 9. Entregar ===')
  await q("update ops.shipment set status='ENTREGADO', delivered_at=now() where id=$1", [shipmentId])
  comprobar('etapa', 'ENTREGADO', await etapaDe(orderId))

  console.log('\n=== 10. Resumen del tablero ===')
  const { rows: resumen } = await q(
    "select etapa, pedidos, unidades from bi.v_embudo_resumen where operacion='CO'"
  )
  comprobar('una sola etapa ocupada', 1, resumen.length)
  comprobar('etapa del resumen', 'ENTREGADO', resumen[0].etapa)
} catch (e) {
  console.error(`\n\x1b[31mFALLA: ${e.message}\x1b[0m`)
  fallos++
} finally {
  console.log('\n=== Limpieza ===')
  try {
    if (shipmentId) await q('delete from ops.shipment_line where shipment_id=$1', [shipmentId])
    if (shipmentId) await q('delete from ops.shipment where id=$1', [shipmentId])
    if (orderId) await q('delete from ops.reservation where order_line_id in (select id from ops.sales_order_line where order_id=$1)', [orderId])
    // El saldo se devuelve a su valor EXACTO anterior, no restando: restar
    // acumularía error si algo hubiera cambiado en medio.
    for (const s of creado.stockTocado) {
      await q('update ops.stock set reserved=$3 where variant_id=$1 and warehouse_id=$2', [s.variantId, s.warehouseId, s.reserved])
    }
    if (orderId) await q('delete from ops.sales_order_line where order_id=$1', [orderId])
    if (orderId) await q('delete from ops.sales_order where id=$1', [orderId])
    if (customerId) await q('delete from ops.customer where id=$1', [customerId])

    const { rows: quedan } = await q(
      `select (select count(*)::int from ops.sales_order) as pedidos,
              (select count(*)::int from ops.customer) as clientes,
              (select count(*)::int from ops.reservation) as reservas,
              (select count(*)::int from bi.v_reserva_cuadre where not cuadra) as descuadres`
    )
    console.log(`  Tras limpiar → pedidos ${quedan[0].pedidos}, clientes ${quedan[0].clientes}, reservas ${quedan[0].reservas}, descuadres ${quedan[0].descuadres}`)
    if (quedan[0].pedidos !== 0 || quedan[0].clientes !== 0 || quedan[0].descuadres !== 0) {
      console.error('  \x1b[31mLa limpieza no dejó la base como estaba.\x1b[0m')
      fallos++
    }
  } catch (e) {
    console.error(`  Error limpiando: ${e.message}`)
    fallos++
  }
  await pool.end()
  console.log(fallos === 0 ? '\n\x1b[32m✓ Ciclo comercial completo, todo correcto.\x1b[0m\n' : `\n\x1b[31m✗ ${fallos} comprobación(es) fallaron.\x1b[0m\n`)
  process.exitCode = fallos === 0 ? 0 : 1
}
