import { Module } from '@medusajs/framework/utils'

import SupplyAvailabilityModuleService from './service'

export const SUPPLY_AVAILABILITY_MODULE = 'supply_availability'

export default Module(SUPPLY_AVAILABILITY_MODULE, {
  service: SupplyAvailabilityModuleService,
})
