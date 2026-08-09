import { defineLink } from '@medusajs/framework/utils'
import ProductModule from '@medusajs/medusa/product'

import SupplyAvailabilityModule from '../modules/supply-availability'

// Una variante puede tener varias disponibilidades a la vez: en el proveedor
// y en distintos tránsitos con ETA diferente. De ahí `isList` en ese lado.
export default defineLink(
  ProductModule.linkable.productVariant,
  {
    linkable: SupplyAvailabilityModule.linkable.supplyAvailability,
    isList: true,
  }
)
