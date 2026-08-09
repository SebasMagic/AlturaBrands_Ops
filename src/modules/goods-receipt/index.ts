import { Module } from '@medusajs/framework/utils'

import GoodsReceiptModuleService from './service'

export const GOODS_RECEIPT_MODULE = 'goods_receipt'

export default Module(GOODS_RECEIPT_MODULE, {
  service: GoodsReceiptModuleService,
})
