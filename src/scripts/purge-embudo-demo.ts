import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  cancelOrderWorkflow,
  deleteCustomersWorkflow,
} from '@medusajs/medusa/core-flows'

/**
 * Elimina los pedidos y clientes de demostración del embudo.
 *
 * Acotado por el prefijo DEMO en el correo, nunca por criterio amplio: este
 * script va a convivir con clientes reales.
 *
 * Los pedidos se CANCELAN, no se borran: Medusa no ofrece borrado de pedidos
 * porque un pedido es un hecho contable. Cancelarlos los saca del tablero y
 * libera las reservas, que es el efecto que se busca.
 *
 *   pnpm exec medusa exec ./src/scripts/purge-embudo-demo.ts
 */

const PREFIJO_EMAIL = 'demo-'

export default async function purgeEmbudoDemo({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const customerService = container.resolve(Modules.CUSTOMER)
  const orderService = container.resolve(Modules.ORDER)

  const clientes = await customerService.listCustomers({}, { select: ['id', 'email'] })
  const demo = clientes.filter((c: any) =>
    String(c.email ?? '').startsWith(PREFIJO_EMAIL)
  )

  if (demo.length === 0) {
    logger.info('No hay clientes de demo. Nada que limpiar.')
    return
  }
  logger.info(`Clientes de demo: ${demo.map((c: any) => c.email).join(', ')}`)

  const pedidos = await orderService.listOrders(
    { customer_id: demo.map((c: any) => c.id) },
    { select: ['id', 'display_id', 'status', 'canceled_at'] }
  )

  let cancelados = 0
  for (const p of pedidos as any[]) {
    if (p.canceled_at) continue
    try {
      await cancelOrderWorkflow(container).run({ input: { order_id: p.id } })
      cancelados++
    } catch (e: any) {
      logger.warn(`  pedido #${p.display_id}: no se pudo cancelar — ${e.message}`)
    }
  }
  logger.info(`Pedidos cancelados: ${cancelados} de ${pedidos.length}`)

  await deleteCustomersWorkflow(container).run({
    input: { ids: demo.map((c: any) => c.id) },
  })
  logger.info(`Clientes de demo borrados: ${demo.length}`)

  const restantes = await customerService.listCustomers({}, { select: ['id'] })
  logger.info(`Clientes restantes: ${restantes.length}`)
}
