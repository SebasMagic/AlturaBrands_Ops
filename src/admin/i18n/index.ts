import en from './json/en.json'
import es from './json/es.json'

/**
 * Traducciones del admin.
 *
 * El dashboard hace `deepMerge` de esto sobre sus propias traducciones, así
 * que basta con declarar las claves que queremos cambiar. Es el único punto
 * soportado para renombrar entradas del menú nativo: la barra lateral es parte
 * del marco y no se puede reconstruir (CLAUDE.md §4.5), pero sus etiquetas
 * salen de aquí.
 *
 * CUIDADO CON LA FORMA — aquí ya se falló una vez.
 *
 * Tiene que ser `{ <idioma>: { translation: {...} } }`. El nivel `translation`
 * no es decorativo: es el espacio de nombres por defecto de i18next
 * (`fallbackNS: "translation"`), y sin él las claves quedan un nivel más
 * arriba, i18next no las encuentra y el override sale mudo — sin error y sin
 * aviso, simplemente no pasa nada. La versión anterior exportaba `{ en }` y
 * por eso nunca funcionó.
 *
 * El plugin de Vite envuelve este export en `{ resources: ... }` por su
 * cuenta; no lo añadas aquí.
 */
export default {
  en: {
    translation: en,
  },
  es: {
    translation: es,
  },
}
