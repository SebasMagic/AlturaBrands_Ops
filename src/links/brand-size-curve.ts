import { defineLink } from '@medusajs/framework/utils'

import BrandModule from '../modules/brand'
import SizeCurveModule from '../modules/size-curve'

// Las curvas pertenecen a la marca: son parte de sus reglas de pedido, igual
// que `order_unit`. Baja cardinalidad, así que un Module Link es lo correcto.
export default defineLink(BrandModule.linkable.brand, {
  linkable: SizeCurveModule.linkable.sizeCurve,
  isList: true,
})
