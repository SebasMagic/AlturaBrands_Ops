/**
 * Genera el CSS de marca con el logo incrustado como data URI.
 *
 * Se genera con un script porque el data URI del logo son ~126 KB de base64
 * que no tiene sentido mantener a mano.
 */
const fs = require("node:fs")
const path = require("node:path")

const RAIZ = "C:\\dev\\AlturaBrands_Ops"
const LOGO = path.join(RAIZ, "logo altura black.png")
const SALIDA = path.join(RAIZ, "src", "admin", "styles", "branding.css")

const b64 = fs.readFileSync(LOGO).toString("base64")
const dataUri = `data:image/png;base64,${b64}`
console.log(`Logo: ${(fs.statSync(LOGO).size / 1024).toFixed(0)} KB`)

const css = `/* =============================================================================
   Marca AlturaBrands sobre la pantalla de acceso
   =============================================================================

   Lo que se ve en pantalla lo dibuja el widget \`src/admin/widgets/login-branding.tsx\`,
   montado en la zona oficial \`login.before\`. Este archivo hace solo dos cosas:

     1. Oculta el logo y los títulos propios de Medusa.
     2. Aporta el fondo, la tarjeta y el estilo del logo (que vive aquí porque
        el data URI son 126 KB y no tiene sitio en un componente).

   ADVERTENCIA acotada: el punto 1 depende de clases que genera Medusa. Si tras
   actualizar el dashboard reaparece el logo de Medusa junto al nuestro, el
   sospechoso es este archivo — concretamente la regla marcada más abajo.
   Borrarlo devuelve el admin a su aspecto original sin romper nada.

   Se generó con etl/generar-branding.js; no lo edites a mano.
   ============================================================================= */

:root {
  --altura-logo: url('${dataUri}');
  --altura-fondo: #0b1220;
  --altura-acento: #c2410c;
}

/* -----------------------------------------------------------------------------
   Fondo de la pantalla de acceso.
   El contenedor raíz del login es el único del admin que combina alto y ancho
   de viewport completos, así que sirve para distinguirlo sin tocar el resto.
   -------------------------------------------------------------------------- */
div.min-h-dvh.w-dvw {
  background-image:
    radial-gradient(
      ellipse 90% 55% at 50% -5%,
      rgba(194, 65, 12, 0.22),
      transparent 62%
    ),
    linear-gradient(180deg, #0b1220 0%, #0f172a 58%, #111827 100%);
  background-color: var(--altura-fondo);
}

/* La tarjeta del formulario, para que respire sobre el fondo oscuro */
div.min-h-dvh.w-dvw > div {
  max-width: 360px;
  padding: 2.25rem 1.75rem 1.5rem;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(10px);
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.6);
}

/* -----------------------------------------------------------------------------
   REGLA FRÁGIL — ver advertencia de la cabecera.

   Oculta los dos primeros hijos de la tarjeta de acceso: el logo de Medusa y el
   bloque de "Bienvenido a Medusa". Los reemplaza nuestro widget, que se monta
   justo debajo.

   Se filtra por \`max-w-[280px]\` a propósito: el mismo contenedor de pantalla
   completa se reutiliza para el desafío MFA, y ahí ocultar hijos por posición
   dejaría la pantalla inservible.
   -------------------------------------------------------------------------- */
div.min-h-dvh.w-dvw > div.max-w-\\[280px\\] > *:nth-child(1),
div.min-h-dvh.w-dvw > div.max-w-\\[280px\\] > *:nth-child(2) {
  display: none !important;
}

/* -----------------------------------------------------------------------------
   Nuestra marca (widget login-branding.tsx)
   -------------------------------------------------------------------------- */
.altura-login-marca {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 0.75rem;
}

.altura-login-logo {
  width: 190px;
  height: 62px;
  margin-bottom: 1rem;
  background-image: var(--altura-logo);
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  /* El logo original es negro sobre transparente: invertirlo lo vuelve blanco,
     que es lo que pide el fondo oscuro. */
  filter: invert(1);
}

.altura-login-titulo {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: #fff;
  text-align: center;
}

.altura-login-sub {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.6);
  text-align: center;
}

/* -----------------------------------------------------------------------------
   Contraste de los campos sobre el fondo oscuro
   -------------------------------------------------------------------------- */
div.min-h-dvh.w-dvw input {
  background: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(255, 255, 255, 0.13) !important;
  color: #fff !important;
}

div.min-h-dvh.w-dvw input::placeholder {
  color: rgba(255, 255, 255, 0.38) !important;
}

div.min-h-dvh.w-dvw button[type='submit'] {
  background: var(--altura-acento) !important;
  border-color: transparent !important;
  color: #fff !important;
  font-weight: 600;
}

div.min-h-dvh.w-dvw button[type='submit']:hover {
  filter: brightness(1.1);
}

div.min-h-dvh.w-dvw a {
  color: rgba(255, 255, 255, 0.75);
}
`

fs.writeFileSync(SALIDA, css, "utf8")
console.log(`Escrito: ${SALIDA}`)
console.log(`Tamano: ${(css.length / 1024).toFixed(0)} KB`)
