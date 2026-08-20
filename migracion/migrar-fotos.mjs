#!/usr/bin/env node
/**
 * Trae las fotos de producto del CDN ajeno a nuestro Storage.
 *
 *   node migracion/migrar-fotos.mjs           # migra lo que falte
 *   node migracion/migrar-fotos.mjs --forzar  # rehace todas
 *
 * Idempotente: sólo toca los productos cuya `thumbnail_url` sigue apuntando
 * fuera. Se puede cortar a media ejecución y relanzar sin duplicar nada.
 *
 * El nombre del archivo es el código de material (`1001870.jpg`), no un uuid:
 * así el objeto es predecible, se puede reemplazar sin dejar huérfanos, y
 * mirando el bucket se sabe de qué producto es cada foto.
 *
 * Sube autenticado como un usuario real en vez de con la clave de servicio:
 * esa clave no debe salir del dashboard, y las políticas del bucket ya
 * permiten escribir a cualquier autenticado.
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

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://xkcngokwgxmoirswmnja.supabase.co'
const ANON = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_4VvnIFMuZYS0TAZAk-8fGQ_r2ptdTrn'
const EMAIL = process.env.MIGRACION_EMAIL
const PASSWORD = process.env.MIGRACION_PASSWORD
const BUCKET = 'producto'
const FORZAR = process.argv.includes('--forzar')

if (!EMAIL || !PASSWORD) {
  console.error(
    'Faltan MIGRACION_EMAIL y MIGRACION_PASSWORD.\n' +
      'Se usan sólo para autenticarse contra Storage; no se guardan en ningún sitio.'
  )
  process.exit(2)
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

async function main() {
  const cliente = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await cliente.connect()

  // --- Autenticación --------------------------------------------------------
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const sesion = await auth.json()
  if (!sesion.access_token) {
    console.error('No se pudo autenticar:', JSON.stringify(sesion).slice(0, 200))
    process.exit(1)
  }
  const token = sesion.access_token
  console.log(`Autenticado como ${sesion.user.email}\n`)

  // --- Qué migrar -----------------------------------------------------------
  const { rows: productos } = await cliente.query(
    FORZAR
      ? `select material, coalesce(thumbnail_origen, thumbnail_url) as origen
           from ops.product
          where coalesce(thumbnail_origen, thumbnail_url) is not null
          order by material`
      : `select material, thumbnail_url as origen
           from ops.product
          where thumbnail_url is not null
            and thumbnail_url not like $1
          order by material`,
    FORZAR ? [] : [`${SUPABASE_URL}%`]
  )

  if (productos.length === 0) {
    console.log('Nada que migrar: todas las fotos ya están en Storage propio.')
    await cliente.end()
    return
  }
  console.log(`${productos.length} foto(s) por traer.\n`)

  let ok = 0
  const fallos = []

  for (const [i, p] of productos.entries()) {
    const etiqueta = `[${String(i + 1).padStart(3)}/${productos.length}] ${p.material}`
    try {
      const img = await fetch(p.origen)
      if (!img.ok) throw new Error(`origen respondió ${img.status}`)

      const tipo = (img.headers.get('content-type') ?? '').split(';')[0].trim()
      const ext = EXT[tipo]
      if (!ext) throw new Error(`tipo no admitido: ${tipo || 'desconocido'}`)

      const bytes = Buffer.from(await img.arrayBuffer())
      // Una respuesta 200 con cuerpo diminuto suele ser una página de error
      // disfrazada, no una imagen. Mejor fallar que guardar basura.
      if (bytes.length < 1024) throw new Error(`sólo ${bytes.length} bytes`)

      const ruta = `${p.material}.${ext}`
      const subida = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${ruta}`, {
        method: 'POST',
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${token}`,
          'Content-Type': tipo,
          // Reemplaza si ya existía: hace el script relanzable.
          'x-upsert': 'true',
        },
        body: bytes,
      })
      if (!subida.ok) {
        throw new Error(`Storage respondió ${subida.status}: ${(await subida.text()).slice(0, 120)}`)
      }

      const publica = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${ruta}`
      await cliente.query(
        `update ops.product
            set thumbnail_url = $2,
                thumbnail_origen = coalesce(thumbnail_origen, $3)
          where material = $1`,
        [p.material, publica, p.origen]
      )

      ok++
      console.log(`  ${etiqueta}  ${(bytes.length / 1024).toFixed(0)} KB  ✓`)
    } catch (e) {
      fallos.push({ material: p.material, motivo: e.message })
      console.log(`  ${etiqueta}  ✗ ${e.message}`)
    }
  }

  console.log(`\n${ok} migrada(s), ${fallos.length} fallida(s).`)
  if (fallos.length) {
    console.log('\nFallidas (conservan su URL original, no se pierde nada):')
    for (const f of fallos) console.log(`  · ${f.material}: ${f.motivo}`)
  }

  const { rows: estado } = await cliente.query(
    `select
       count(*) filter (where thumbnail_url like $1)     as en_storage_propio,
       count(*) filter (where thumbnail_url is not null
                          and thumbnail_url not like $1) as en_cdn_ajeno,
       count(*) filter (where thumbnail_url is null)     as sin_foto
     from ops.product`,
    [`${SUPABASE_URL}%`]
  )
  console.log(
    `\nEstado: ${estado[0].en_storage_propio} propias · ` +
      `${estado[0].en_cdn_ajeno} en CDN ajeno · ${estado[0].sin_foto} sin foto.`
  )

  await cliente.end()
  process.exitCode = fallos.length > 0 ? 1 : 0
}

main().catch((e) => {
  console.error(`\nLa migración se detuvo: ${e.message}`)
  process.exit(1)
})
