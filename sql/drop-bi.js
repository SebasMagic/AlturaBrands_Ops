/**
 * Elimina el schema `bi` completo.
 *
 * Postgres no permite alterar el tipo de una columna de la que cuelga una
 * vista, así que la capa de BI bloquea las migraciones de Medusa. Como es
 * capa de lectura pura y se reconstruye en un segundo, la solución es tirarla
 * antes de migrar y volver a aplicarla después. Eso hace `pnpm db:migrate`.
 *
 * NO borra datos: `bi` solo contiene vistas.
 */
const fs = require("node:fs")
const path = require("node:path")
const { Client } = require("pg")

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
const url = env.match(/^DIRECT_URL=(.*)$/m)?.[1]?.trim()
if (!url) {
  console.error("Falta DIRECT_URL en .env")
  process.exit(1)
}

const main = async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query("drop schema if exists bi cascade")
  await c.end()
  console.log("schema bi eliminado (se reconstruye al final de la migracion)")
}

main().catch((e) => {
  console.error("Error:", e.message)
  process.exit(1)
})
