import { defineLink } from '@medusajs/framework/utils'

import BrandModule from '../modules/brand'
import OperationModule from '../modules/operation'

// Qué marcas representa cada operación. Baja cardinalidad y relación real de
// negocio (una marca puede representarse en varios países y viceversa), así
// que aquí un Module Link sí es la herramienta correcta.
export default defineLink(
  {
    linkable: OperationModule.linkable.operation,
    isList: true,
  },
  {
    linkable: BrandModule.linkable.brand,
    isList: true,
  }
)
