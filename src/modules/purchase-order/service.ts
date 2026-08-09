import { MedusaService } from '@medusajs/framework/utils'

import {
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderSize,
} from './models/purchase-order'

class PurchaseOrderModuleService extends MedusaService({
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderSize,
}) {}

export default PurchaseOrderModuleService
