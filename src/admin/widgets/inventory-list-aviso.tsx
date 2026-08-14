import { defineWidgetConfig } from '@medusajs/admin-sdk'
import { ArrowUpRightOnBox } from '@medusajs/icons'
import { Text } from '@medusajs/ui'
import { Link } from 'react-router-dom'

/**
 * Señaliza la diferencia entre las dos vistas de inventario.
 *
 * Esta lista y `/inventario` leen el mismo módulo, pero sirven para cosas
 * distintas: aquí se ajustan existencias, allí se decide qué pedir. Sin un
 * letrero, quien llega aquí buscando la posición del surtido no encuentra
 * nada — la tabla nativa muestra una fila por talla y no sabe de tránsito.
 *
 * Va en la zona `inventory_item.list.before`, que es lo único que Medusa
 * permite tocar de esta pantalla: la tabla tiene sus columnas fijas en código.
 */
const InventoryListAviso = () => (
  <div className="border-ui-border-base bg-ui-bg-base flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3">
    <Text size="small" className="text-ui-fg-subtle">
      Stock Master es el repositorio: aquí se{' '}
      <strong className="text-ui-fg-base">cargan y ajustan</strong> las
      existencias, talla por talla. Para ver la posición por producto —con foto,
      stock en tránsito y disponibilidad en la marca—
    </Text>
    <Link
      to="/inventario"
      className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover inline-flex items-center gap-x-1 text-sm font-medium"
    >
      abre Inventario
      <ArrowUpRightOnBox />
    </Link>
  </div>
)

export const config = defineWidgetConfig({
  zone: 'inventory_item.list.before',
})

export default InventoryListAviso
