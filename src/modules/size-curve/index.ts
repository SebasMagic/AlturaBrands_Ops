import { Module } from '@medusajs/framework/utils'

import SizeCurveModuleService from './service'

export const SIZE_CURVE_MODULE = 'size_curve'

export default Module(SIZE_CURVE_MODULE, {
  service: SizeCurveModuleService,
})
