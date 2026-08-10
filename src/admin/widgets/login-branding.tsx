import { defineWidgetConfig } from '@medusajs/admin-sdk'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import '../styles/branding.css'

/**
 * Marca de AlturaBrands en la pantalla de acceso.
 *
 * Va en la zona `login.before`, que es un punto de extensión oficial del
 * dashboard: no depende de clases internas de Medusa ni sustituye texto con
 * pseudo-elementos. El intento anterior dibujaba el título con `::after` sobre
 * el original y, al ser nuestro texto más largo, se montaba sobre el subtítulo.
 *
 * El logo y los títulos de Medusa se ocultan desde `branding.css`; lo que ves
 * en pantalla es este componente.
 */

const IDIOMA_POR_DEFECTO = 'es'

/**
 * Marca propia. Hace falta porque `lng` no sirve para saber si el usuario
 * eligió idioma: i18next guarda ahí tanto la elección del perfil como el
 * idioma que detecta solo del navegador, y quedan indistinguibles. Casi todo
 * el mundo tiene ya un `lng=en` que nadie eligió.
 *
 * Con esta marca el cambio a español ocurre UNA vez por navegador; a partir de
 * ahí manda lo que el usuario ponga en su perfil.
 */
const MARCA_IDIOMA = 'altura.idioma-inicial'

/**
 * Se ejecuta al cargar el bundle, no al pintar el login: así también alcanza a
 * quien entra con la sesión ya abierta y nunca ve esta pantalla. i18next lee
 * `lng` al arrancar, de modo que como muy tarde aplica en la siguiente carga.
 */
if (typeof window !== 'undefined' && !window.localStorage.getItem(MARCA_IDIOMA)) {
  window.localStorage.setItem(MARCA_IDIOMA, IDIOMA_POR_DEFECTO)
  window.localStorage.setItem('lng', IDIOMA_POR_DEFECTO)
}

const LoginBranding = () => {
  const { i18n } = useTranslation()

  useEffect(() => {
    // El dashboard ya viene traducido al español; solo hay que seleccionarlo.
    // Esto cubre la carga actual: lo de arriba solo deja el valor listo para
    // el siguiente arranque de i18next.
    if (!i18n.language || i18n.language.startsWith(IDIOMA_POR_DEFECTO)) {
      return
    }
    if (window.localStorage.getItem('lng') !== IDIOMA_POR_DEFECTO) {
      return // el usuario eligió otro idioma; se respeta
    }
    void i18n.changeLanguage(IDIOMA_POR_DEFECTO)
  }, [i18n])

  return (
    <div className="altura-login-marca">
      <div className="altura-login-logo" role="img" aria-label="AlturaBrands" />
      <h1 className="altura-login-titulo">Sistema de Operaciones</h1>
      <p className="altura-login-sub">Ingresa con tu cuenta</p>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: 'login.before',
})

export default LoginBranding
