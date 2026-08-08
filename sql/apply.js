/**
 * Aplica los ficheros .sql de este directorio, en orden alfabético.
 *
 * Usa DIRECT_URL (session mode) porque son sentencias DDL, que el transaction
 * pooler no maneja bien — ver CLAUDE.md §3.
 *
 *   node sql/apply.js            aplica todo
 *   node sql/apply.js bi         aplica solo sql/bi/
 */
const fs = require("node:fs")
const path = require("node:path")
const { Client } = require("pg")

const ROOT = __dirname
const sub = process.argv[2]
const dir = sub ? path.join(ROOT, sub) : ROOT

const envPath = path.join(ROOT, "..", ".env")
const env = fs.readFileSync(envPath, "utf8")
const url = env.match(/^DIRECT_URL=(.*)$/m)?.[1]?.trim()
if (!url) {
  console.error("Falta DIRECT_URL en .env")
  process.exit(1)
}

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()

if (files.length === 0) {
  console.error(`No hay ficheros .sql en ${dir}`)
  process.exit(1)
}

const main = async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8")
    process.stdout.write(`aplicando ${f} ... `)
    try {
      await c.query(sql)
      console.log("OK")
    } catch (e) {
      console.log("FALLO")
      console.error(`  ${e.message}`)
      await c.end()
      process.exit(1)
    }
  }
  await c.end()
  console.log(`\n${files.length} fichero(s) aplicados.`)
}

main().catch((e) => {
  console.error("Error:", e.message)
  process.exit(1)
})
