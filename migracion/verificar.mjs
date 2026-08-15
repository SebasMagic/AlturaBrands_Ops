#!/usr/bin/env node
/**
 * Corre el test de caracterización y devuelve código de salida.
 *
 *   node migracion/verificar.mjs
 *
 * Sale 0 si todo pasa, 1 si algo falla. Toda la lógica de comparación vive en
 * `caracterizacion.sql` a propósito: así el mismo archivo se puede pegar en el
 * editor de Supabase y leer el reporte sin Node de por medio. Este script sólo
 * lo ejecuta y lo pinta.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')

/**
 * Lee .env a mano en vez de traer dotenv: es una sola variable y no vale una
 * dependencia. No pisa lo que ya venga del entorno — en CI mandan las
 * variables reales, no el archivo local.
 */
function cargarEnv() {
  let texto
  try {
    texto = readFileSync(join(RAIZ, '.env'), 'utf8')
  } catch {
    return
  }
  for (const linea of texto.split('\n')) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith('#')) continue
    const corte = limpia.indexOf('=')
    if (corte === -1) continue
    const clave = limpia.slice(0, corte).trim()
    if (process.env[clave] !== undefined) continue
    process.env[clave] = limpia.slice(corte + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const ANCHOS = { grupo: 16, chequeo: 40, esperado: 12, obtenido: 12 }
const pad = (v, n) => String(v ?? '—').padEnd(n)
const padIzq = (v, n) => String(v ?? '—').padStart(n)

function pintar(filas) {
  console.log(
    '\n' +
      pad('GRUPO', ANCHOS.grupo) +
      pad('CHEQUEO', ANCHOS.chequeo) +
      padIzq('ESPERADO', ANCHOS.esperado) +
      padIzq('OBTENIDO', ANCHOS.obtenido) +
      '   ESTADO'
  )
  console.log('─'.repeat(96))

  let grupoPrevio = null
  for (const f of filas) {
    // El grupo sólo se imprime cuando cambia: la columna repetida es ruido y
    // esta tabla se lee de un vistazo, no se filtra.
    const grupo = f.grupo === grupoPrevio ? '' : f.grupo
    grupoPrevio = f.grupo
    const ok = f.estado === 'OK'
    console.log(
      pad(grupo, ANCHOS.grupo) +
        pad(f.chequeo, ANCHOS.chequeo) +
        padIzq(f.esperado, ANCHOS.esperado) +
        padIzq(f.obtenido, ANCHOS.obtenido) +
        (ok ? '   \x1b[32mOK\x1b[0m' : '   \x1b[31mFALLA\x1b[0m')
    )
  }
}

async function main() {
  cargarEnv()

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('Falta DATABASE_URL (en .env o en el entorno).')
    process.exit(2)
  }

  const sql = readFileSync(join(AQUI, 'caracterizacion.sql'), 'utf8')

  const cliente = new pg.Client({
    connectionString: url,
    // Supabase exige TLS y el pooler presenta un certificado que la cadena de
    // confianza de Node no valida. Es una consulta de solo lectura contra un
    // host conocido; el riesgo aceptado es no verificar la cadena, no ir en claro.
    ssl: { rejectUnauthorized: false },
  })

  await cliente.connect()
  try {
    const { rows } = await cliente.query(sql)
    pintar(rows)

    const fallas = rows.filter((f) => f.estado !== 'OK')
    console.log('─'.repeat(96))

    if (fallas.length === 0) {
      console.log(`\n\x1b[32m✓ ${rows.length} chequeos, todos OK.\x1b[0m\n`)
      return
    }

    console.log(
      `\n\x1b[31m✗ ${fallas.length} de ${rows.length} chequeos fallaron:\x1b[0m`
    )
    for (const f of fallas) {
      console.log(`   · ${f.grupo} — ${f.chequeo}: esperado ${f.esperado}, obtenido ${f.obtenido}`)
    }
    console.log()
    process.exitCode = 1
  } finally {
    await cliente.end()
  }
}

main().catch((e) => {
  console.error(`\nNo se pudo correr la verificación: ${e.message}\n`)
  process.exit(2)
})
