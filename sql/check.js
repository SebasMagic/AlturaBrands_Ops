/**
 * Comprobación de conectividad y estado de la base.
 *
 *   node sql/check.js
 *
 * Verifica las DOS conexiones por separado, porque fallan de formas distintas:
 * DIRECT_URL (session, 5432) es la de DDL y migraciones; DATABASE_URL
 * (transaction pooler, 6543) es la de runtime. Que una funcione no dice nada
 * de la otra — ver CLAUDE.md §10.
 *
 * No imprime credenciales.
 */
const fs = require("node:fs")
const path = require("node:path")
const { Client } = require("pg")

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
const leer = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? ""

const probar = async (nombre, url, esperado) => {
  if (!url || url.includes("[ref]")) {
    console.log(`  ${nombre.padEnd(14)} SIN CONFIGURAR`)
    return null
  }
  const u = new URL(url)
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try {
    await c.connect()
    const r = await c.query("select current_user, inet_server_port() as puerto")
    const puertoOk = u.port === esperado
    console.log(
      `  ${nombre.padEnd(14)} OK  ${u.hostname}:${u.port}  ` +
        `usuario=${r.rows[0].current_user}` +
        (puertoOk ? "" : `  <-- se esperaba puerto ${esperado}`)
    )
    return c
  } catch (e) {
    console.log(`  ${nombre.padEnd(14)} FALLO  ${u.hostname}:${u.port}  ${e.message}`)
    try {
      await c.end()
    } catch {}
    return null
  }
}

const main = async () => {
  console.log("CONEXIONES\n")
  const directo = await probar("DIRECT_URL", leer("DIRECT_URL"), "5432")
  const runtime = await probar("DATABASE_URL", leer("DATABASE_URL"), "6543")
  if (runtime) await runtime.end()

  if (!directo) {
    console.log("\nSin conexión de DDL. No se puede seguir.")
    process.exit(1)
  }

  const r = await directo.query(`
    select
      (select count(*)::int from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE')   as tablas,
      (select count(*)::int from information_schema.views
        where table_schema='bi')                                    as vistas_bi,
      (select count(*)::int from auth.users)                        as usuarios_auth,
      pg_size_pretty(pg_database_size(current_database()))          as tamano
  `)
  const x = r.rows[0]
  console.log("\nESTADO DE LA BASE\n")
  console.log(`  tablas en public   ${x.tablas}`)
  console.log(`  vistas en bi       ${x.vistas_bi}`)
  console.log(`  usuarios de Auth   ${x.usuarios_auth}`)
  console.log(`  tamaño             ${x.tamano}`)

  const rls = await directo.query(`
    select c.relname as tabla, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `)
  if (rls.rowCount) {
    const sin = rls.rows.filter((t) => !t.rls)
    console.log(`\nRLS: ${rls.rowCount - sin.length} de ${rls.rowCount} tablas con RLS activo`)
    if (sin.length) {
      console.log("  SIN RLS (revisar):")
      sin.forEach((t) => console.log(`    ${t.tabla}`))
    }
  }

  console.log("\nVariables de Supabase:")
  for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const v = leer(k)
    console.log(`  ${k.padEnd(26)} ${v ? "<con valor>" : "(vacía)"}`)
  }

  await directo.end()
}

main().catch((e) => {
  console.error("Error:", e.message)
  process.exit(1)
})
