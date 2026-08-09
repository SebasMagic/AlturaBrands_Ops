import { defineLink } from '@medusajs/framework/utils'
import ProductModule from '@medusajs/medusa/product'

import BrandModule from '../modules/brand'

// Una marca agrupa muchos productos, de ahí `isList` en el lado del producto.
export default defineLink(
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  },
  BrandModule.linkable.brand
)
