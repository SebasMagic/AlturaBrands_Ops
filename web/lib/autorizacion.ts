import { Pool } from 'pg'

/**
 * Comprobación de autorización para el middleware.
 *
 * Vive aparte de `lib/db/*` porque el middleware se empaqueta por separado:
 * arrastrar ahí el pool de la aplicación metería en el bundle todo el resto
 * de la capa de datos.
 *
 * POR QUÉ EN EL MIDDLEWARE Y NO EN EL LAYOUT. Se intentó primero en el layout
 * raíz y FILTRABA: Next renderiza la página en paralelo con el layout, así que
 * cuando el layout llamaba a `redirect()` los datos del ERP ya estaban
 * calculados y viajaban en el cuerpo del 307 — 503 KB con el inventario
 * completo, invisibles en el navegador pero legibles con `curl`. El middleware
 * corta antes de que la página se ejecute.
 */

let pool: Pool | undefined

function getPool(): Pool | null {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return null
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
  return pool
}

/**
 * Caché de la lista de autorizados.
 *
 * Sin esto habría una consulta por cada request, incluida cada navegación
 * interna. La lista es diminuta y cambia muy de vez en cuando, así que 30
 * segundos de desfase es un intercambio razonable: dar de baja a alguien tarda
 * como mucho medio minuto en surtir efecto.
 */
let cache: { emails: Set<string>; hasta: number } | null = null
const TTL_MS = 30_000

export async function estaAutorizado(email: string, ahora: number): Promise<boolean> {
  const normalizado = email.toLowerCase().trim()

  if (cache && cache.hasta > ahora) return cache.emails.has(normalizado)

  const p = getPool()
  // Sin base de datos no se puede comprobar a nadie: se niega el acceso. Es la
  // dirección segura del fallo.
  if (!p) return false

  try {
    const { rows } = await p.query('select email from ops.app_user where is_active')
    cache = { emails: new Set(rows.map((r) => String(r.email))), hasta: ahora + TTL_MS }
    return cache.emails.has(normalizado)
  } catch {
    // Un fallo de base tampoco puede abrir la puerta. Se invalida la caché
    // para reintentar en el siguiente request en vez de quedar fijado.
    cache = null
    return false
  }
}
