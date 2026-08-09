import { MedusaService } from '@medusajs/framework/utils'

import { SizeCurve, SizeCurveEntry } from './models/size-curve'

class SizeCurveModuleService extends MedusaService({
  SizeCurve,
  SizeCurveEntry,
}) {}

export default SizeCurveModuleService
