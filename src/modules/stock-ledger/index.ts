import { Module } from '@medusajs/framework/utils'

import StockLedgerModuleService from './service'

export const STOCK_LEDGER_MODULE = 'stock_ledger'

export default Module(STOCK_LEDGER_MODULE, {
  service: StockLedgerModuleService,
})
