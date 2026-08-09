import { MedusaService } from '@medusajs/framework/utils'

import { GoodsReceipt, GoodsReceiptLine } from './models/goods-receipt'

class GoodsReceiptModuleService extends MedusaService({
  GoodsReceipt,
  GoodsReceiptLine,
}) {}

export default GoodsReceiptModuleService
