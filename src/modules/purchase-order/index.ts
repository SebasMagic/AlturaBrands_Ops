import { Module } from '@medusajs/framework/utils'

import PurchaseOrderModuleService from './service'

export const PURCHASE_ORDER_MODULE = 'purchase_order'

export default Module(PURCHASE_ORDER_MODULE, {
  service: PurchaseOrderModuleService,
})
