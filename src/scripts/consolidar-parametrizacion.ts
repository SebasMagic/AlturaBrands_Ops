import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import { deleteRegionsWorkflow } from '@medusajs/medusa/core-flows'

/**
 * Consolida la parametrización dejada por el sembrador de demo.
 *
 * Aquel script corría en CADA migración y creaba un canal de venta nuevo cada
 * vez: se acumularon cuatro "Default Sales Channel" idénticos, más un perfil
 * de envío y una región europea que no pintan nada aquí.
 *
 * No se pueden borrar sin más: los 334 productos y la bodega cuelgan de ellos.
 * El orden importa — primero se reasigna, después se borra. Al revés dejaría
 * productos sin canal, invisibles en el admin y no vendibles, sin ningún error
 * que lo explique.
 *
 * Idempotente.
 *
 *   pnpm exec medusa exec ./src/scripts/consolidar-parametrizacion.ts
 */

const CANAL_BUENO = 'Mayoreo Colombia'
const PERFIL_BUENO = 'Estándar'
const REGIONES_A_BORRAR = ['Europe']

export default async function consolidar({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const channelService = container.resolve(Modules.SALES_CHANNEL)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const regionService = container.resolve(Modules.REGION)
  const productService = container.resolve(Modules.PRODUCT)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)

  // --- Canal de venta ----------------------------------------------------
  const canales = await channelService.listSalesChannels({}, { select: ['id', 'name'] })
  const bueno = canales.find((c: any) => c.name === CANAL_BUENO)
  if (!bueno) {
    throw new Error(`No existe el canal "${CANAL_BUENO}". Corre setup-base.ts primero.`)
  }
  const sobrantes = canales.filter((c: any) => c.id !== bueno.id)
  logger.info(`Canales: 1 bueno, ${sobrantes.length} a consolidar`)

  if (sobrantes.length) {
    // Reasignar TODOS los productos al canal bueno antes de borrar nada.
    const productos = await productService.listProducts({}, { select: ['id'] })
    const ids = productos.map((p: any) => p.id)

    await link.create(
      ids.map((id: string) => ({
        [Modules.PRODUCT]: { product_id: id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: bueno.id },
      }))
    )
    logger.info(`  ${ids.length} productos enlazados a ${CANAL_BUENO}`)

    // La bodega también cuelga de un canal.
    const bodegas = await stockLocationService.listStockLocations({}, { select: ['id', 'name'] })
    await link.create(
      bodegas.map((b: any) => ({
        [Modules.SALES_CHANNEL]: { sales_channel_id: bueno.id },
        [Modules.STOCK_LOCATION]: { stock_location_id: b.id },
      }))
    )
    logger.info(`  ${bodegas.length} bodega(s) enlazada(s) a ${CANAL_BUENO}`)

    await channelService.deleteSalesChannels(sobrantes.map((c: any) => c.id))
    logger.info(`  ${sobrantes.length} canal(es) sobrante(s) eliminado(s)`)
  }

  // --- Perfil de envío ---------------------------------------------------
  const perfiles = await fulfillmentService.listShippingProfiles({}, { select: ['id', 'name'] })
  const perfilBueno = perfiles.find((p: any) => p.name === PERFIL_BUENO)
  const perfilesSobrantes = perfiles.filter((p: any) => p.id !== perfilBueno?.id)

  if (perfilBueno && perfilesSobrantes.length) {
    // Los productos guardan el perfil como columna propia, no como link.
    const { data: prods } = await query.graph({
      entity: 'product',
      fields: ['id', 'shipping_profile.id'],
    })
    const aMover = prods.filter(
      (p: any) => p.shipping_profile?.id && p.shipping_profile.id !== perfilBueno.id
    )
    if (aMover.length) {
      for (const p of aMover) {
        await productService.updateProducts(p.id, {
          shipping_profile_id: perfilBueno.id,
        } as any)
      }
      logger.info(`  ${aMover.length} productos movidos al perfil ${PERFIL_BUENO}`)
    }
    await fulfillmentService.deleteShippingProfiles(perfilesSobrantes.map((p: any) => p.id))
    logger.info(`  ${perfilesSobrantes.length} perfil(es) sobrante(s) eliminado(s)`)
  }

  // --- Regiones ajenas ---------------------------------------------------
  const regiones = await regionService.listRegions(
    { name: { $in: REGIONES_A_BORRAR } },
    { select: ['id', 'name'] }
  )
  if (regiones.length) {
    await deleteRegionsWorkflow(container).run({
      input: { ids: regiones.map((r: any) => r.id) },
    })
    logger.info(`  ${regiones.length} región(es) ajena(s) eliminada(s)`)
  }

  // --- Verificación ------------------------------------------------------
  const [c, p, r] = await Promise.all([
    channelService.listSalesChannels({}, { select: ['name'] }),
    fulfillmentService.listShippingProfiles({}, { select: ['name'] }),
    regionService.listRegions({}, { select: ['name', 'currency_code'] }),
  ])

  logger.info('')
  logger.info('--- Parametrización final ---')
  logger.info(`Canales  : ${c.map((x: any) => x.name).join(' · ')}`)
  logger.info(`Envío    : ${p.map((x: any) => x.name).join(' · ')}`)
  logger.info(`Regiones : ${r.map((x: any) => `${x.name} (${x.currency_code})`).join(' · ')}`)

  const ok = c.length === 1 && p.length === 1 && r.length === 2
  logger.info(ok ? 'RESULTADO: limpio.' : 'RESULTADO: revisar, quedan duplicados.')
}
