#!/usr/bin/env node
/**
 * Valida un archivo DDL corriéndolo de verdad y revirtiendo.
 *
 *   node migracion/validar.mjs migracion/001_schema_ops.sql
 *
 * Todo ocurre dentro de una transacción que siempre termina en rollback: el
 * esquema se comprueba contra Postgres real (tipos, FKs, CHECKs, triggers,
 * vistas) sin dejar nada creado. Un dry-run que de verdad ejecuta.
 *
 * El reporte lista TABLAS y VISTAS en `ops` y `bi` tal como quedan dentro de
 * la transacción — no asume qué tipo de objeto crea el archivo, porque
 * distintas fases crean cosas distintas (Fase 1 tablas, Fase 3 vistas).
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'
for (const l of readFileSync('.env', 'utf8').split('\n')) {
  const s = l.trim(); if (!s || s.startsWith('#')) continue
  const i = s.indexOf('='); if (i === -1) continue
  const k = s.slice(0, i).trim()
  if (process.env[k] === undefined) process.env[k] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const sql = readFileSync(process.argv[2], 'utf8')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
try {
  await c.query('begin')
  await c.query(sql)

  const { rows } = await c.query(`
    select n.nspname as schema, c.relname as nombre,
           case c.relkind when 'r' then 'tabla' when 'v' then 'vista' else c.relkind::text end as tipo
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('ops','bi') and c.relkind in ('r','v')
    order by n.nspname, c.relkind, c.relname`)

  for (const schema of ['ops', 'bi']) {
    const del = rows.filter((r) => r.schema === schema)
    if (del.length === 0) continue
    console.log(`\n${schema} — ${del.length} objetos:`)
    for (const r of del) console.log(`  · ${schema}.${r.nombre} (${r.tipo})`)
  }

  const { rows: cons } = await c.query(
    "select count(*) n from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='ops'")
  console.log(`\nRestricciones en ops: ${cons[0].n}`)

  await c.query('rollback')
  console.log('\nRevertido: no quedó nada creado.')
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error(`\nFALLA: ${e.message}`)
  if (e.position) console.error(`  posición ${e.position}`)
  if (e.hint) console.error(`  pista: ${e.hint}`)
  process.exitCode = 1
} finally { await c.end() }
