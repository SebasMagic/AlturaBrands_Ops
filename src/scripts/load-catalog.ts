import fs from 'node:fs'
import path from 'node:path'

import { ExecArgs } from '@medusajs/framework/types'
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from '@medusajs/framework/utils'
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
} from '@medusajs/medusa/core-flows'

import { BRAND_MODULE } from '../modules/brand'

/**
 * Carga el catálogo maestro (paso 4).
 *
 * Fuente: data/master-data.json, producido por etl/transform_master_data.py.
 * Este script NO interpreta el Excel: si algo del origen está mal, se corrige
 * en el ETL y se vuelve a generar el JSON. Una sola fuente de verdad.
 *
 * Idempotente por `handle`: los productos ya existentes se omiten, así que
 * puede reejecutarse tras un fallo parcial sin duplicar nada.
 *
 *   pnpm exec medusa exec ./src/scripts/load-catalog.ts
 */

const BATCH_SIZE = 20
const CURRENCY = 'usd'

type Variante = {
  sku: string
  talla_label: string
  escala: string | null
  talla_valor: number | null
  pendiente_desglose: boolean
}

type Producto = {
  material: number
  title: string
  handle: string
  modelo: string | null
  genero: string | null
  categoria: string
  color: string | null
  escala: string | null
  precio_msrp_usd_cents: number | null
  precio_proveedor_usd_cents: number | null
  costo_usd_cents: number | null
  variantes: Variante[]
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export default async function loadCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const productService = container.resolve(Modules.PRODUCT)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const regionService = container.resolve(Modules.REGION)
  const brandService: any = container.resolve(BRAND_MODULE)

  const jsonPath = path.join(process.cwd(), 'data', 'master-data.json')
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `No existe ${jsonPath}. Genera el JSON antes: python etl/transform_master_data.py`
    )
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const productos: Producto[] = data.productos

  logger.info(
    `Origen: ${data.meta.productos} productos, ${data.meta.variantes} variantes, ` +
      `cuadre_ok=${data.meta.cuadre_ok}`
  )
  if (!data.meta.cuadre_ok) {
    throw new Error('El JSON no cuadra contra el Excel. Se aborta la carga.')
  }

  // --- 1. Marca ----------------------------------------------------------
  let [brand] = await brandService.listBrands({ code: 'KEEN' })
  if (!brand) {
    brand = await brandService.createBrands({ code: 'KEEN', name: 'KEEN' })
    logger.info(`Marca creada: ${brand.code}`)
  } else {
    logger.info(`Marca ya existente: ${brand.code}`)
  }

  // --- 2. Región en USD --------------------------------------------------
  // El maestro está en USD. La lista de precios local se añadirá cuando el
  // negocio la defina, sin rehacer el catálogo (CLAUDE.md §5 -> pricing).
  let [region] = await regionService.listRegions({ name: 'Estados Unidos' })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          { name: 'Estados Unidos', currency_code: CURRENCY, countries: ['us'] },
        ],
      },
    })
    region = result[0]
    logger.info(`Región creada: ${region.name} (${region.currency_code})`)
  } else {
    logger.info(`Región ya existente: ${region.name}`)
  }

  // --- 3. Categorías -----------------------------------------------------
  const nombresCategoria = [...new Set(productos.map((p) => p.categoria))].sort()
  const existentes = await productService.listProductCategories(
    {},
    { select: ['id', 'name'] }
  )
  const porNombre = new Map(existentes.map((c: any) => [c.name, c.id]))

  const faltantes = nombresCategoria.filter((n) => !porNombre.has(n))
  if (faltantes.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: faltantes.map((name) => ({
          name,
          handle: slugify(name),
          is_active: true,
        })),
      },
    })
    result.forEach((c: any) => porNombre.set(c.name, c.id))
    logger.info(`Categorías creadas: ${faltantes.join(', ')}`)
  }
  logger.info(`Categorías disponibles: ${porNombre.size}`)

  // --- 4. Canal de venta y perfil de envío -------------------------------
  const [salesChannel] = await salesChannelService.listSalesChannels({})
  const [shippingProfile] = await fulfillmentService.listShippingProfiles({})
  if (!salesChannel) throw new Error('No hay canal de venta configurado.')
  if (!shippingProfile) throw new Error('No hay perfil de envío configurado.')

  // --- 5. Productos ------------------------------------------------------
  const yaExisten = await productService.listProducts({}, { select: ['id', 'handle'] })
  const handlesExistentes = new Set(yaExisten.map((p: any) => p.handle))

  const pendientes = productos.filter((p) => !handlesExistentes.has(p.handle))
  logger.info(
    `Productos a crear: ${pendientes.length} ` +
      `(${productos.length - pendientes.length} ya existían y se omiten)`
  )

  const creados: { id: string; material: number }[] = []
  let sinPrecio = 0

  for (let i = 0; i < pendientes.length; i += BATCH_SIZE) {
    const lote = pendientes.slice(i, i + BATCH_SIZE)

    const input = lote.map((p) => {
      const tallas = p.variantes.map((v) => v.talla_label)

      // Medusa v2 guarda importes en la unidad MAYOR (160 = $160.00), a
      // diferencia de v1 que usaba centavos. El ETL trabaja en centavos para
      // evitar arrastre de float, así que aquí se divide una sola vez.
      const precio =
        p.precio_msrp_usd_cents !== null ? p.precio_msrp_usd_cents / 100 : null
      if (precio === null) sinPrecio++

      return {
        title: p.title,
        handle: p.handle,
        status: ProductStatus.PUBLISHED,
        shipping_profile_id: shippingProfile.id,
        sales_channels: [{ id: salesChannel.id }],
        category_ids: [porNombre.get(p.categoria)!].filter(Boolean) as string[],
        options: [{ title: 'Talla', values: tallas }],
        metadata: {
          material: String(p.material),
          modelo: p.modelo,
          genero: p.genero,
          color: p.color,
          escala_talla: p.escala,
          // Campos propios: se mantienen en centavos enteros por CLAUDE.md §6.
          // La regla de la unidad mayor solo aplica a los precios nativos.
          costo_usd_cents: p.costo_usd_cents,
          precio_proveedor_usd_cents: p.precio_proveedor_usd_cents,
        },
        variants: p.variantes.map((v) => ({
          title: v.talla_label,
          sku: v.sku,
          manage_inventory: true,
          options: { Talla: v.talla_label },
          prices: precio !== null ? [{ amount: precio, currency_code: CURRENCY }] : [],
          metadata: {
            escala: v.escala,
            talla_valor: v.talla_valor,
            // Marca las unidades WIDE y fuera de corrida, pendientes de que
            // el negocio entregue el desglose real por talla.
            pendiente_desglose: v.pendiente_desglose,
          },
        })),
      }
    })

    const { result } = await createProductsWorkflow(container).run({
      input: { products: input as any },
    })

    result.forEach((prod: any, idx: number) =>
      creados.push({ id: prod.id, material: lote[idx].material })
    )

    logger.info(
      `Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${result.length} productos ` +
        `(${creados.length}/${pendientes.length})`
    )
  }

  // --- 6. Enlazar productos con la marca ---------------------------------
  if (creados.length) {
    await link.create(
      creados.map((c) => ({
        [Modules.PRODUCT]: { product_id: c.id },
        [BRAND_MODULE]: { brand_id: brand.id },
      }))
    )
    logger.info(`Enlazados ${creados.length} productos a la marca ${brand.code}`)
  }

  // --- 7. Resumen --------------------------------------------------------
  const finalProducts = await productService.listProducts({}, { select: ['id'] })
  const finalVariants = await productService.listProductVariants({}, { select: ['id'] })

  logger.info('')
  logger.info('--- Resumen ---')
  logger.info(`Productos en catálogo : ${finalProducts.length}`)
  logger.info(`Variantes en catálogo : ${finalVariants.length}`)
  logger.info(`Productos sin precio   : ${sinPrecio}`)
  logger.info(`Esperado del JSON      : ${data.meta.productos} / ${data.meta.variantes}`)
}
