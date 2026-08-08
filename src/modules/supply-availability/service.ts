import { MedusaService } from '@medusajs/framework/utils'

import SupplyAvailability from './models/supply-availability'

class SupplyAvailabilityModuleService extends MedusaService({
  SupplyAvailability,
}) {}

export default SupplyAvailabilityModuleService
