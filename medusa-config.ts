import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Conexión a Postgres (Supabase) — ver CLAUDE.md §3.
 *
 * Supabase expone dos modos que NO son intercambiables:
 *   - session mode (5432)     → migraciones. El transaction pooler rompe
 *                               prepared statements y DDL.
 *   - transaction pooler(6543)→ runtime. Mejor concurrencia.
 *
 * Medusa lee una sola variable (DATABASE_URL), también para migraciones, así
 * que el cambio se activa por bandera desde los scripts de package.json:
 * `pnpm db:migrate` y `pnpm db:generate` exportan MEDUSA_DB_MODE=migration.
 * Nunca llames a `medusa db:*` directo: usa siempre los scripts.
 */
const isMigration = process.env.MEDUSA_DB_MODE === 'migration'
const databaseUrl = isMigration
  ? process.env.DIRECT_URL
  : process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    isMigration
      ? 'Falta DIRECT_URL (session mode, puerto 5432). Requerida para migraciones — CLAUDE.md §3.'
      : 'Falta DATABASE_URL (transaction pooler, puerto 6543). Requerida en runtime — CLAUDE.md §3.'
  )
}

/**
 * Redis — cache, event bus y workflow engine (CLAUDE.md §9.3).
 *
 * Sin REDIS_URL, Medusa cae a las implementaciones en memoria: sirven para
 * levantar el admin en local, pero NO soportan el proceso worker separado de
 * §4.6 ni jobs fiables. En despliegue REDIS_URL es obligatoria.
 */
// Se valida la forma, no solo que la variable exista: un marcador sin sustituir
// es "truthy" y haria que Medusa intente conectarse a un host inexistente,
// fallando con errores de DNS que no apuntan a la causa.
const rawRedisUrl = process.env.REDIS_URL?.trim()
const redisUrl = /^rediss?:\/\//.test(rawRedisUrl ?? '') ? rawRedisUrl : undefined

if (rawRedisUrl && !redisUrl) {
  console.warn(
    `[config] REDIS_URL no parece una URL de Redis ("${rawRedisUrl.slice(0, 20)}..."). ` +
      'Se ignora y se usa cache en memoria. Debe empezar por redis:// o rediss://.'
  )
}

const redisModules = redisUrl
  ? [
      {
        resolve: '@medusajs/medusa/caching',
        options: {
          providers: [
            {
              resolve: '@medusajs/caching-redis',
              id: 'caching-redis',
              is_default: true,
              options: { redisUrl },
            },
          ],
        },
      },
      {
        resolve: '@medusajs/medusa/event-bus-redis',
        options: { redisUrl },
      },
      {
        resolve: '@medusajs/medusa/workflow-engine-redis',
        options: { redis: { redisUrl } },
      },
    ]
  : []

module.exports = defineConfig({
  projectConfig: {
    databaseUrl,
    // Sesiones del admin. Es una conexion distinta de la de los modulos: sin
    // esto Medusa las guarda en memoria y cada reinicio expulsa a todo el
    // mundo, ademas de no compartirse entre los procesos server y worker (§4.6).
    redisUrl,
    redisPrefix: 'alturabrands:',
    // En Railway, server y worker corren este mismo código y se distinguen por
    // esta variable (CLAUDE.md §4.6). En local, `shared` = un solo proceso.
    workerMode:
      (process.env.MEDUSA_WORKER_MODE as 'shared' | 'worker' | 'server') ??
      'shared',
    databaseDriverOptions: {
      // Supabase exige TLS. El pooler presenta un certificado que no encadena
      // con la CA del sistema, de ahí rejectUnauthorized: false.
      ssl: { rejectUnauthorized: false },
      connection: { ssl: { rejectUnauthorized: false } },
    },
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules: redisModules,
})
