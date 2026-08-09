/**
 * Descarga el catálogo público de KEEN.
 *
 * KEEN corre sobre Shopify, que expone `/products.json` paginado. Bajarlo
 * entero una vez y cruzar en local es preferible a construir 265 URLs a mano:
 * no depende de adivinar el patrón del slug, y de paso trae el `sku` por talla
 * — que es el UPC/EAN real de KEEN, el dato que nos falta para códigos de
 * barras.
 *
 * Guarda una versión recortada (lo que usamos) en data/keen-catalogo.json.
 *
 *   node etl/descargar-catalogo-keen.js
 */
const fs = require('node:fs')
const path = require('node:path')

const BASE = 'https://www.keenfootwear.com/products.json'
const POR_PAGINA = 250
const MAX_PAGINAS = 60 // tope de seguridad; el bucle corta antes al vaciarse
const PAUSA_MS = 400 // cortesía con el servidor de un socio comercial

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

const pedir = async (pagina) => {
  const url = `${BASE}?limit=${POR_PAGINA}&page=${pagina}`
  for (let intento = 1; intento <= 4; intento++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlturaBrandsERP/1.0)' },
      })
      if (r.status === 429 || r.status >= 500) {
        const espera = 1500 * intento
        console.log(`  HTTP ${r.status}, reintento en ${espera}ms`)
        await dormir(espera)
        continue
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()).products ?? []
    } catch (e) {
      if (intento === 4) throw e
      await dormir(1500 * intento)
    }
  }
  return []
}

const main = async () => {
  const productos = []

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const lote = await pedir(pagina)
    if (lote.length === 0) {
      console.log(`Página ${pagina}: vacía, fin del catálogo.`)
      break
    }

    for (const p of lote) {
      productos.push({
        handle: p.handle,
        title: p.title,
        product_type: p.product_type,
        // Se guardan las dimensiones porque la galería de KEEN mezcla fotos de
        // producto (cuadradas) con banners de estilo de vida apaisados; sin la
        // proporción no hay forma de distinguirlos, y un banner de miniatura
        // queda mal en la grilla.
        images: (p.images ?? []).map((i) => ({ src: i.src, w: i.width, h: i.height })),
        variants: (p.variants ?? []).map((v) => ({
          // `title` es la talla tal cual la publica KEEN ("8.5 / Regular")
          title: v.title,
          sku: v.sku,
          available: v.available,
        })),
      })
    }

    console.log(
      `Página ${String(pagina).padStart(2)}: ${lote.length} productos ` +
        `(acumulado ${productos.length})`
    )
    if (lote.length < POR_PAGINA) {
      console.log('Última página incompleta, fin del catálogo.')
      break
    }
    await dormir(PAUSA_MS)
  }

  const salida = path.join(process.cwd(), 'data', 'keen-catalogo.json')
  fs.writeFileSync(salida, JSON.stringify(productos), 'utf8')

  const conImagen = productos.filter((p) => p.images.length > 0).length
  const variantes = productos.reduce((a, p) => a + p.variants.length, 0)
  const conSku = productos.reduce(
    (a, p) => a + p.variants.filter((v) => v.sku).length,
    0
  )

  console.log('')
  console.log(`Productos       : ${productos.length}`)
  console.log(`  con imagen    : ${conImagen}`)
  console.log(`Variantes       : ${variantes}`)
  console.log(`  con SKU/UPC   : ${conSku}`)
  console.log(`Escrito         : ${salida} (${(fs.statSync(salida).size / 1048576).toFixed(1)} MB)`)
}

main().catch((e) => {
  console.error('FALLÓ:', e.message)
  process.exit(1)
})
