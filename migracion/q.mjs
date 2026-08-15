#!/usr/bin/env node
/**
 * Consulta ad-hoc contra la base del proyecto, en JSON.
 *
 *   node migracion/q.mjs "select count(*) from bi.v_posicion"
 *
 * Existe para inspeccionar durante la migración sin depender del MCP ni del
 * editor web. Solo lectura por disciplina, no por permisos: las escrituras van
 * por migración.
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
  if (process.env[k] === undefined) {
    process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const sql = process.argv[2]
if (!sql) {
  console.error('Uso: node migracion/q.mjs "<sql>"')
  process.exit(2)
}

const cliente = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
await cliente.connect()
try {
  const { rows } = await cliente.query(sql)
  console.log(JSON.stringify(rows, null, 2))
} finally {
  await cliente.end()
}
