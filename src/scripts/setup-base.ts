import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingProfilesWorkflow,
  createStoresWorkflow,
  updateStoresWorkflow,
} from '@medusajs/medusa/core-flows'

/**
 * Parametrización base de AlturaBrands.
 *
 * Reemplaza al sembrador de demo del starter, que creaba tienda en euros,
 * región Europa, impuestos de la UE y una bodega europea — y lo rehacía en
 * CADA migración, así que la basura volvía sola por mucho que se limpiara.
 *
 * Idempotente: se puede correr las veces que haga falta.
 *
 *   pnpm exec medusa exec ./src/scripts/setup-base.ts
 */

/**
 * COP es la moneda por defecto porque es la de la operación: lo que el
 * negocio cobra y reporta. USD queda soportada porque el catálogo maestro
 * viene de la marca en dólares y hay que poder compararse contra él.
 */
const MONEDAS = [
  { currency_code: 'cop', is_default: true },
  { currency_code: 'usd', is_default: false },
]

const REGIONES = [
  // Donde se VENDE. Los precios de venta al mayorista viven aquí.
  { name: 'Colombia', currency_code: 'cop', countries: ['co'] },
  // Donde se COMPRA. Conserva la referencia del maestro en dólares.
  { name: 'Estados Unidos', currency_code: 'usd', countries: ['us'] },
]

const CANAL = 'Mayoreo Colombia'
const PERFIL_ENVIO = 'Estándar'

export default async function setupBase({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const storeService = container.resolve(Modules.STORE)
  const regionService = container.resolve(Modules.REGION)
  const channelService = container.resolve(Modules.SALES_CHANNEL)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)

  // --- Tienda y monedas --------------------------------------------------
  let [store] = await storeService.listStores({})
  if (!store) {
    const { result } = await createStoresWorkflow(container).run({
      input: { stores: [{ name: 'AlturaBrands', supported_currencies: MONEDAS }] },
    })
    store = result[0]
    logger.info('Tienda creada: AlturaBrands')
  } else {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: { name: 'AlturaBrands', supported_currencies: MONEDAS },
      },
    })
    logger.info('Tienda actualizada: AlturaBrands · monedas cop (por defecto) + usd')
  }

  // --- Canal de venta ----------------------------------------------------
  let [canal] = await channelService.listSalesChannels({ name: CANAL })
  if (!canal) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: CANAL }] },
    })
    canal = result[0]
    logger.info(`Canal de venta creado: ${CANAL}`)
  } else {
    logger.info(`Canal de venta ya existente: ${CANAL}`)
  }

  // --- Perfil de envío ---------------------------------------------------
  let [perfil] = await fulfillmentService.listShippingProfiles({ name: PERFIL_ENVIO })
  if (!perfil) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: PERFIL_ENVIO, type: 'default' }] },
    })
    perfil = result[0]
    logger.info(`Perfil de envío creado: ${PERFIL_ENVIO}`)
  } else {
    logger.info(`Perfil de envío ya existente: ${PERFIL_ENVIO}`)
  }

  // --- Regiones ----------------------------------------------------------
  for (const r of REGIONES) {
    const [existe] = await regionService.listRegions({ name: r.name })
    if (existe) {
      logger.info(`Región ya existente: ${r.name} (${existe.currency_code})`)
      continue
    }
    await createRegionsWorkflow(container).run({ input: { regions: [r] } })
    logger.info(`Región creada: ${r.name} (${r.currency_code})`)
  }

  // --- Resumen -----------------------------------------------------------
  const regiones = await regionService.listRegions({})
  const canales = await channelService.listSalesChannels({})
  const perfiles = await fulfillmentService.listShippingProfiles({})

  logger.info('')
  logger.info('--- Parametrización ---')
  logger.info(`Tienda   : ${store.name}`)
  logger.info(
    `Regiones : ${regiones.map((x: any) => `${x.name} (${x.currency_code})`).join(' · ')}`
  )
  logger.info(`Canales  : ${canales.map((x: any) => x.name).join(' · ')}`)
  logger.info(`Envío    : ${perfiles.map((x: any) => x.name).join(' · ')}`)

  const sobrantes = regiones.filter(
    (x: any) => !REGIONES.some((r) => r.name === x.name)
  )
  if (sobrantes.length) {
    logger.warn(
      `Regiones que no son de AlturaBrands: ${sobrantes.map((x: any) => x.name).join(', ')}. ` +
        'Bórralas con purge-demo-data.ts.'
    )
  }
}
