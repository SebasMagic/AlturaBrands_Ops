import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  createCustomersWorkflow,
  createOrderWorkflow,
} from '@medusajs/medusa/core-flows'

/**
 * Crea pedidos de demostración repartidos por el embudo.
 *
 * Existe para VERIFICAR que la vista bi.v_embudo clasifica bien. Sin datos en
 * cada etapa, la lógica del CASE es una afirmación sin prueba.
 *
 * Todo lo que crea lleva el prefijo DEMO para poder borrarlo sin tocar nada
 * real.
 *
 *   pnpm exec medusa exec ./src/scripts/seed-embudo-demo.ts
 */

const PREFIJO = 'DEMO'

export default async function seedEmbudo({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT)
  const regionService = container.resolve(Modules.REGION)
  const channelService = container.resolve(Modules.SALES_CHANNEL)
  const customerService = container.resolve(Modules.CUSTOMER)

  const [region] = await regionService.listRegions({ name: 'Estados Unidos' })
  const [canal] = await channelService.listSalesChannels({})
  if (!region || !canal) throw new Error('Falta la región o el canal de venta.')

  /**
   * Solo variantes con existencias PROPIAS y disponibles.
   *
   * Medusa rechaza crear un pedido sobre variantes sin inventario, que es
   * exactamente lo que debe hacer. Elegir "las primeras 12" fallaba porque de
   * 3.064 variantes apenas 190 tienen stock, y casi todas con 1 o 2 pares.
   */
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const conStock = await knex.raw(`
    select sku, vendible_hoy
    from bi.v_posicion
    where vendible_hoy > 0
    order by vendible_hoy desc
    limit 12
  `)
  const skus = (conStock.rows ?? []).map((r: any) => r.sku)
  const disponiblePorSku = new Map<string, number>(
    (conStock.rows ?? []).map((r: any) => [r.sku, Number(r.vendible_hoy)])
  )

  const variantes = await productService.listProductVariants(
    { sku: skus },
    { select: ['id', 'sku', 'title'] }
  )
  if (variantes.length < 6) {
    throw new Error(
      `Solo ${variantes.length} variantes con existencias vendibles. ` +
        'Carga inventario antes de sembrar el embudo.'
    )
  }
  logger.info(
    `Variantes con stock disponible: ${variantes.length} ` +
      `(máximo por variante: ${Math.max(...disponiblePorSku.values())})`
  )

  // --- Clientes -----------------------------------------------------------
  const existentes = await customerService.listCustomers({
    email: [
      `${PREFIJO.toLowerCase()}-calzatodo@local.test`,
      `${PREFIJO.toLowerCase()}-deportes-sur@local.test`,
      `${PREFIJO.toLowerCase()}-outdoor-andes@local.test`,
    ],
  })

  let clientes = existentes
  if (clientes.length === 0) {
    const { result } = await createCustomersWorkflow(container).run({
      input: {
        customersData: [
          {
            email: `${PREFIJO.toLowerCase()}-calzatodo@local.test`,
            first_name: 'DEMO Calzatodo',
            last_name: 'Bogotá',
          },
          {
            email: `${PREFIJO.toLowerCase()}-deportes-sur@local.test`,
            first_name: 'DEMO Deportes Sur',
            last_name: 'Cali',
          },
          {
            email: `${PREFIJO.toLowerCase()}-outdoor-andes@local.test`,
            first_name: 'DEMO Outdoor Andes',
            last_name: 'Medellín',
          },
        ],
      },
    })
    clientes = result
    logger.info(`Clientes de demo creados: ${clientes.length}`)
  } else {
    logger.info(`Clientes de demo ya existentes: ${clientes.length}`)
  }

  // --- Pedidos ------------------------------------------------------------
  // Cada uno nace en una etapa distinta. Las que dependen de despacho se
  // dejan para cuando exista un proveedor de fulfillment configurado; la
  // vista ya las contempla.
  const definiciones = [
    { cliente: 0, draft: true, lineas: 3, nota: 'COTIZACION' },
    { cliente: 1, draft: false, lineas: 2, nota: 'PEDIDO' },
    { cliente: 2, draft: false, lineas: 4, nota: 'PEDIDO' },
  ]

  const creados: string[] = []
  for (const [i, def] of definiciones.entries()) {
    const cliente = clientes[def.cliente % clientes.length]
    // Nunca más de lo disponible: el objetivo es probar el embudo, no chocar
    // contra la validación de inventario.
    const items = variantes.slice(i * 2, i * 2 + def.lineas).map((v: any) => ({
      variant_id: v.id,
      quantity: Math.max(1, Math.min(2, disponiblePorSku.get(v.sku) ?? 1)),
      unit_price: 120 + i * 10,
      title: v.title ?? v.sku,
    }))

    const { result } = await createOrderWorkflow(container).run({
      input: {
        region_id: region.id,
        sales_channel_id: canal.id,
        customer_id: cliente.id,
        email: cliente.email,
        currency_code: 'usd',
        is_draft_order: def.draft,
        items,
      } as any,
    })
    creados.push((result as any).id)
    logger.info(
      `  ${def.nota.padEnd(11)} ${cliente.first_name} · ${items.length} líneas`
    )
  }

  logger.info('')
  logger.info(`Pedidos de demo creados: ${creados.length}`)
  logger.info('Verifica con: select * from bi.v_embudo_resumen order by etapa_orden;')
}
