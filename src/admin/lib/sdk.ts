import Medusa from '@medusajs/js-sdk'

/**
 * Cliente autenticado para las pantallas del admin.
 *
 * Es la forma que documenta Medusa y la única fiable: `fetch` crudo con
 * `credentials: 'include'` funciona por casualidad mientras el admin y la API
 * compartan origen exacto, y deja de funcionar en cuanto hay un dominio, un
 * proxy o un puerto distinto — sin dar un error que lo explique.
 *
 * `__BACKEND_URL__` lo inyecta Medusa al compilar el admin, así que la misma
 * compilación sirve en local y en el dominio de producción.
 */
export const sdk = new Medusa({
  baseUrl: __BACKEND_URL__ || '/',
  auth: { type: 'session' },
})
