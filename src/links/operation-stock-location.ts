import { defineLink } from '@medusajs/framework/utils'
import StockLocationModule from '@medusajs/medusa/stock-location'

import OperationModule from '../modules/operation'

// A qué operación pertenece cada bodega. `stock_location` es del core, así que
// no se le añade columna: se enlaza (CLAUDE.md §4.2).
export default defineLink(
  {
    linkable: OperationModule.linkable.operation,
    isList: true,
  },
  StockLocationModule.linkable.stockLocation
)
