import { Module } from '@medusajs/framework/utils'

import OperationModuleService from './service'

export const OPERATION_MODULE = 'operation'

export default Module(OPERATION_MODULE, {
  service: OperationModuleService,
})
