#!/usr/bin/env node
/**
 * Aplica un archivo SQL de verdad, dentro de una transacción.
 *
 *   node migracion/aplicar.mjs migracion/001_schema_ops.sql
 *
 * Todo o nada: si cualquier sentencia falla, se revierte el archivo completo.
 * A diferencia de `validar.mjs`, este confirma.
 *
 * Antes de usarlo conviene pasar el mismo archivo por `validar.mjs`, que hace
 * exactamente lo mismo pero termina en rollback.
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

const archivo = process.argv[2]
if (!archivo) {
  console.error('Uso: node migracion/aplicar.mjs <archivo.sql>')
  process.exit(2)
}

const sql = readFileSync(archivo, 'utf8')
const cliente = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

await cliente.connect()
const inicio = Date.now()
try {
  await cliente.query('begin')
  await cliente.query(sql)
  await cliente.query('commit')
  console.log(`\x1b[32m✓\x1b[0m ${archivo} aplicado en ${Date.now() - inicio} ms.`)
} catch (e) {
  await cliente.query('rollback').catch(() => {})
  console.error(`\n\x1b[31m✗ ${archivo} — revertido entero.\x1b[0m`)
  console.error(`  ${e.message}`)
  if (e.detail) console.error(`  detalle: ${e.detail}`)
  if (e.hint) console.error(`  pista: ${e.hint}`)
  process.exitCode = 1
} finally {
  await cliente.end()
}
