/**
 * Empareja nuestros productos sin foto con el catálogo público de KEEN.
 *
 * La clave del cruce es (género + color), no el nombre del modelo: el color es
 * el campo más literal de los dos lados ("BIRCH/STAR WHITE" ↔ "Birch/Star
 * White"), mientras que el modelo cambia de forma entre el maestro y la web
 * ("TARGHEE II MID WP" ↔ "Targhee II Waterproof Mid"). El modelo se usa
 * después, solo para desempatar entre candidatos del mismo color.
 *
 * No escribe nada en la base: deja el resultado en JSON para revisarlo antes
 * de cargar.
 *
 *   node etl/emparejar-fotos-keen.js
 */
const fs = require('node:fs')
const path = require('node:path')

const DIR = path.join(process.cwd(), 'data')

// --- Normalización ---------------------------------------------------------

/** Nuestro género → cómo lo escribe KEEN en el título. */
const GENERO = {
  MEN: 'men',
  WOMEN: 'women',
  YOUTH: 'big kids',
  CHILDREN: 'little kids',
  TOTS: 'toddlers',
}

/**
 * Prefijos de género de KEEN. El apóstrofo baila entre "Big Kid's" y
 * "Big Kids'", así que se normaliza antes de comparar.
 */
const PREFIJOS = [
  // El apóstrofo desaparece al normalizar, así que "Men's" llega como "men s".
  // Los más largos van primero: "women s" antes que "men s".
  ['women s', 'women'],
  ['womens', 'women'],
  ['men s', 'men'],
  ['mens', 'men'],
  ['big kids', 'big kids'],
  ['big kid s', 'big kids'],
  ['little kids', 'little kids'],
  ['little kid s', 'little kids'],
  ['toddlers', 'toddlers'],
  ['toddler s', 'toddlers'],
  ['all gender', 'all gender'],
]

/** Abreviaturas del maestro → palabra que usa KEEN en la web. */
const EXPANSIONES = {
  wp: 'waterproof',
  lea: 'leather',
  ltr: 'leather',
  vented: 'vent', // KEEN publica "Vented"; el maestro abrevia "VENT"
}

/**
 * Tokens que no discriminan: o son categoría genérica que KEEN añade al
 * título, o códigos internos nuestros que la web no publica.
 */
const RUIDO = new Set([
  // categoría genérica de KEEN
  'sneaker', 'sandal', 'shoe', 'shoes', 'boot', 'boots', 'hiking',
  'slide', 'flip', 'flop', 'walking', 'sport', 'casual', 'winter',
  'wrap', 'strap', 'double', 'knit',
  // códigos nuestros sin reflejo en la web
  'tg', 'ds',
])

/**
 * Tokens que pueden faltar en el título sin que el emparejamiento sea falso:
 * KEEN los deja implícitos en la categoría ("Boot" ya implica caña media).
 */
const OPCIONALES = new Set(['mid', 'low'])

const normalizar = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\bgray\b/g, 'grey')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const tokens = (s) =>
  normalizar(s)
    .split(' ')
    .filter(Boolean)
    .map((t) => EXPANSIONES[t] ?? t)
    .filter((t) => !RUIDO.has(t))

// --- Lectura del catálogo de KEEN -----------------------------------------

/** Parte un título de KEEN en género, modelo y color. */
const desmenuzar = (title) => {
  const [izqCrudo, derCrudo] = title.split('|')
  if (!derCrudo) return null

  let izq = normalizar(izqCrudo)
  let genero = null
  for (const [patron, canonico] of PREFIJOS) {
    if (izq.startsWith(patron + ' ')) {
      genero = canonico
      izq = izq.slice(patron.length + 1)
      break
    }
  }
  if (!genero) return null

  // Altura de caña. Nuestro maestro la marca en el modelo ("MID"/"LOW");
  // KEEN la deja en la categoría: la bota es "Boot", el zapato es "Shoe".
  // Sin esto, "TARGHEE IV WP" y "TARGHEE IV MID WP" son indistinguibles y
  // ambos empatan contra los mismos dos productos.
  const corte = /\bboot\b/.test(izq) ? 'boot' : /\bshoe\b/.test(izq) ? 'shoe' : null

  return { genero, modelo: izq, color: normalizar(derCrudo), corte }
}

/**
 * Deja solo las fotos de producto. La galería de KEEN intercala banners de
 * campaña apaisados que, de miniatura, no dejan ver el zapato.
 * Si un producto solo tuviera banners, se prefiere eso a dejarlo sin foto.
 */
const fotosDeProducto = (imagenes) => {
  const utiles = imagenes.filter((i) => !i.w || !i.h || i.w / i.h <= 1.5)
  return (utiles.length ? utiles : imagenes).map((i) => i.src)
}

const catalogo = require(path.join(DIR, 'keen-catalogo.json'))
const indice = new Map() // "genero|color" → [productos]
let sinDesmenuzar = 0

for (const p of catalogo) {
  const d = desmenuzar(p.title)
  if (!d) {
    sinDesmenuzar++
    continue
  }
  const clave = `${d.genero}|${d.color}`
  if (!indice.has(clave)) indice.set(clave, [])
  indice.get(clave).push({ ...p, ...d, modeloTokens: tokens(d.modelo) })
}

// --- Emparejamiento --------------------------------------------------------

/**
 * Qué tan bien encaja nuestro modelo con el de un candidato.
 * Devuelve null si hay una incompatibilidad dura.
 */
const puntuar = (nuestros, suyos, corte) => {
  const suyosSet = new Set(suyos)

  // "WIDE" es horma ancha: un producto ancho y uno normal son artículos
  // distintos, nunca el mismo. Si no coinciden, no es candidato.
  if (nuestros.includes('wide') !== suyosSet.has('wide')) return null

  let presentes = 0
  let exigidos = 0
  for (const t of nuestros) {
    const esta = suyosSet.has(t)
    if (OPCIONALES.has(t) && !esta) continue // no cuenta ni a favor ni en contra
    exigidos++
    if (esta) presentes++
  }
  if (exigidos === 0) return null

  const cobertura = presentes / exigidos
  // Los sobrantes del lado de KEEN NO descalifican: la web añade la categoría
  // al nombre ("HyperFLT Clog", "Zionic Waterproof Hiker"). Solo sirven para
  // desempatar, de modo que entre "Hightrail" y "Hightrail Polar" gane el que
  // no añade palabras.
  const sobrantes = suyos.filter((t) => !nuestros.includes(t)).length

  // Altura de caña: nuestro "MID" es bota; su ausencia (o "LOW") es zapato.
  // Pesa más que los sobrantes porque es una diferencia de producto, no de
  // redacción. Si KEEN no lo declara (sandalias, "Hiker"), no puntúa.
  let ajusteCorte = 0
  if (corte) {
    const esperaBota = nuestros.includes('mid')
    ajusteCorte = esperaBota === (corte === 'boot') ? 0.5 : -0.5
  }

  return { cobertura, punto: cobertura - sobrantes * 0.05 + ajusteCorte }
}

const productos = require(path.join(DIR, 'productos-sin-foto.json'))
const encontrados = []
const ambiguos = []
const sinCandidato = []
const sinModelo = []

for (const p of productos) {
  const genero = GENERO[p.genero]
  const color = normalizar(p.color)
  const candidatos = indice.get(`${genero}|${color}`) ?? []

  if (candidatos.length === 0) {
    sinCandidato.push(p)
    continue
  }

  const nuestros = tokens(p.modelo)
  const puntuados = candidatos
    .map((c) => ({ c, ...(puntuar(nuestros, c.modeloTokens, c.corte) ?? {}) }))
    // Se exige que TODAS nuestras palabras estén en el título de KEEN. Es un
    // filtro duro a propósito: preferimos dejar un producto sin foto antes que
    // ponerle la foto de otro color.
    .filter((x) => x.cobertura === 1)
    .sort((a, b) => b.punto - a.punto)

  if (puntuados.length === 0) {
    sinModelo.push({ ...p, vistos: candidatos.map((c) => c.title) })
    continue
  }
  // Empate real: dos candidatos igual de buenos. Preferimos no adivinar.
  if (puntuados.length > 1 && puntuados[1].punto === puntuados[0].punto) {
    ambiguos.push({ ...p, opciones: puntuados.map((x) => x.c.title) })
    continue
  }

  const g = puntuados[0].c
  encontrados.push({
    material: p.material,
    modelo: p.modelo,
    color: p.color,
    genero: p.genero,
    por_pedir: p.por_pedir,
    keen_title: g.title,
    keen_handle: g.handle,
    imagenes: fotosDeProducto(g.images),
    variants: g.variants,
  })
}

// --- Salida ----------------------------------------------------------------

fs.writeFileSync(
  path.join(DIR, 'fotos-encontradas.json'),
  JSON.stringify(encontrados, null, 2),
  'utf8'
)

// Mismo formato que data/imagenes-productos.json (el cruce contra el CSV de
// Shopify) para que un único cargador consuma las dos fuentes. Los UPC quedan
// aparte: son otro asunto y no deben colarse en la carga de fotos.
fs.writeFileSync(
  path.join(DIR, 'imagenes-keen.json'),
  JSON.stringify(
    encontrados.map((e) => ({
      material: e.material,
      modelo: e.modelo,
      color: e.color,
      genero: e.genero,
      origen: 'keenfootwear.com',
      keen_handle: e.keen_handle,
      imagenes: e.imagenes,
    })),
    null,
    2
  ),
  'utf8'
)

fs.writeFileSync(
  path.join(DIR, 'upc-keen.json'),
  JSON.stringify(
    encontrados.map((e) => ({
      material: e.material,
      keen_handle: e.keen_handle,
      tallas: e.variants.map((v) => ({ talla: v.title, upc: v.sku })),
    })),
    null,
    2
  ),
  'utf8'
)
fs.writeFileSync(
  path.join(DIR, 'fotos-no-encontradas.json'),
  JSON.stringify({ sinCandidato, sinModelo, ambiguos }, null, 2),
  'utf8'
)

const pares = (l) => l.reduce((a, x) => a + (x.por_pedir ?? 0), 0)
const total = productos.length

console.log(`Catálogo KEEN indexado : ${catalogo.length - sinDesmenuzar}/${catalogo.length}`)
console.log('')
console.log(`Productos sin foto     : ${total}`)
console.log(`  EMPAREJADOS          : ${encontrados.length}  (${pares(encontrados).toLocaleString('es-CO')} pares por pedir)`)
console.log(`  color no está en KEEN: ${sinCandidato.length}`)
console.log(`  color sí, modelo no  : ${sinModelo.length}`)
console.log(`  ambiguos             : ${ambiguos.length}`)
console.log('')
console.log(`Imágenes disponibles   : ${encontrados.reduce((a, x) => a + x.imagenes.length, 0)}`)
console.log(`UPC por talla          : ${encontrados.reduce((a, x) => a + x.variants.length, 0)}`)

if (ambiguos.length) {
  console.log('\n--- Ambiguos (no se eligió ninguno) ---')
  ambiguos.slice(0, 10).forEach((a) =>
    console.log(`  ${a.modelo} / ${a.color}\n      ${a.opciones.join('\n      ')}`)
  )
}
if (sinModelo.length) {
  console.log('\n--- Color coincide pero el modelo no (muestra) ---')
  sinModelo.slice(0, 12).forEach((a) =>
    console.log(`  [${a.genero}] ${a.modelo} / ${a.color}  →  ${a.vistos.slice(0, 2).join(' ; ')}`)
  )
}
