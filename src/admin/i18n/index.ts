import en from './json/en.json'

/**
 * Traducciones del admin.
 *
 * Además de los textos de nuestras pantallas, se sobrescriben claves del
 * propio dashboard: `login.title` viene como "Welcome to Medusa" en
 * `@medusajs/dashboard/src/i18n/translations/en.json`, y react-i18next fusiona
 * recursos, así que declarar la misma clave la reemplaza.
 *
 * Es el único punto de extensión real sobre el marco del admin: el logo y la
 * estructura no son personalizables sin bifurcar el dashboard.
 */
export default {
  en,
}
