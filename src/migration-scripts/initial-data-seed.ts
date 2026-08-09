import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/**
 * Deshabilitado a propósito.
 *
 * El starter traía aquí un sembrador de demostración que creaba tienda en
 * euros, región Europa con siete países, regiones fiscales de la UE, una
 * bodega europea y cuatro productos de ejemplo.
 *
 * El problema no era el contenido sino CUÁNDO corría: Medusa ejecuta los
 * migration-scripts en cada `db:migrate`, así que la región Europe y compañía
 * volvían solas después de cada limpieza. Se detectó justamente así — una
 * región en EUR reapareciendo sin que nadie la creara.
 *
 * La parametrización real de AlturaBrands vive en `src/scripts/setup-base.ts`
 * y se ejecuta a mano, que es donde debe estar: una migración cambia el
 * esquema, no siembra datos de negocio.
 *
 * No se borra el archivo para dejar constancia del porqué; si se elimina sin
 * más, alguien acabará restaurándolo del starter sin saber qué provocaba.
 */
export default async function initialDataSeed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info(
    'Sembrado de demo deshabilitado. La parametrización va en ' +
      'src/scripts/setup-base.ts — ver el comentario de este archivo.'
  )
}
