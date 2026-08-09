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

const LoginBranding = () => {
  const { i18n } = useTranslation()

  useEffect(() => {
    // El dashboard ya viene traducido al español; solo hay que seleccionarlo.
    // i18next lo busca en la clave `lng` de localStorage.
    //
    // Solo se fija si el usuario no ha elegido idioma antes: si alguien pone
    // el admin en inglés desde su perfil, esto no debe revertirlo en cada
    // inicio de sesión.
    if (window.localStorage.getItem('lng')) {
      return
    }

    window.localStorage.setItem('lng', IDIOMA_POR_DEFECTO)
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
