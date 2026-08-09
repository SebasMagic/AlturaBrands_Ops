import { defineMiddlewares } from '@medusajs/framework/http'
import multer from 'multer'

/**
 * La hoja de pedido se recibe en memoria: se parsea y se descarta en el acto,
 * así que escribirla en disco solo añadiría limpieza pendiente y un archivo
 * temporal con datos comerciales.
 *
 * El límite de 10 MB es holgado para una hoja de pedido (la de KEEN pesa
 * ~100 KB) y evita que un archivo equivocado tumbe el proceso.
 */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
})

export default defineMiddlewares({
  routes: [
    {
      matcher: '/admin/pedidos/importar',
      method: 'POST',
      middlewares: [subida.single('file')],
    },
  ],
})
