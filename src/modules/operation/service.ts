import { MedusaService } from '@medusajs/framework/utils'

import Operation from './models/operation'

class OperationModuleService extends MedusaService({
  Operation,
}) {}

export default OperationModuleService
