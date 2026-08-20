import { Pool, types } from 'pg'

/**
 * `bigint` (OID 20) como número, no como string.
 *
 * Por defecto `pg` devuelve int8 en texto para no perder precisión más allá de
 * 2^53. El efecto era que TODOS los `id: number` del código eran mentira:
 * llegaban strings y funcionaban por coerción accidental — `'5' - '3'` da 2 en
 * JavaScript, y una comparación con `===` contra un número habría fallado en
 * silencio el día que alguien la escribiera.
 *
 * Es seguro aquí: los ids son columnas `identity` que empiezan en 1, y el
 * importe mayor que manejamos son centavos de pesos, muy por debajo del entero
 * seguro de JavaScript (9.007.199.254.740.991). Si algún día apareciera una
 * columna int8 que de verdad exceda ese rango, habría que leerla como texto
 * explícitamente en su consulta.
 */
types.setTypeParser(types.builtins.INT8, (v) => Number(v))

/**
 * Un solo pool para todo el proceso Node — Server Components y Route Handlers
 * lo comparten en vez de abrir una conexión por request.
 *
 * Corre contra el pooler de Supabase en TRANSACTION MODE (6543): es la
 * conexión de runtime (CLAUDE.md §4). Las migraciones del schema `ops` usan
 * una conexión aparte y viven en `../migracion/`, no aquí.
 *
 * Este archivo sólo se importa desde código de servidor (Server Components,
 * Route Handlers). Si algún día se importa desde un Client Component, Next
 * falla al build — es la señal de que algo rompió la regla de CLAUDE.md §4:
 * "el navegador nunca habla con Postgres".
 */
let pool: Pool | undefined

export function getPool(): Pool {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'Falta DATABASE_URL. Copia web/.env.example a web/.env.local y complétalo.'
    )
  }

  pool = new Pool({
    connectionString,
    // El pooler de Supabase presenta un certificado que la cadena de confianza
    // de Node no valida por defecto. La conexión sigue cifrada (sslmode=require
    // en la URL); lo que se omite es la verificación de la cadena, no el TLS.
    ssl: { rejectUnauthorized: false },

    /**
     * Pequeño a propósito: en Vercel cada instancia serverless tiene SU PROPIO
     * pool, así que el total de conexiones es `max × instancias concurrentes`.
     * Con 10 y una decena de instancias se agotaría el pooler de Supabase.
     * Tres alcanza de sobra: cada request hace una o dos consultas.
     */
    max: 3,
    // Soltar conexiones ociosas rápido: una instancia serverless puede quedar
    // congelada entre peticiones y retener conexiones que ya no usa.
    idleTimeoutMillis: 10_000,
    // Fallar rápido si el pooler no responde, en vez de agotar el tiempo de la
    // función y dejar al usuario mirando una pantalla en blanco.
    connectionTimeoutMillis: 10_000,
  })
  return pool
}
