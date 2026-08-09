import { MedusaService } from '@medusajs/framework/utils'

import StockMove from './models/stock-move'

class StockLedgerModuleService extends MedusaService({
  StockMove,
}) {}

export default StockLedgerModuleService
