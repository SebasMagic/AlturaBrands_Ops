/// <reference types="vite/client" />

/**
 * URL del backend, inyectada por el compilador del admin de Medusa.
 *
 * Se declara aquí porque es un global de tiempo de compilación: no existe en
 * el código fuente, lo sustituye el bundler. Sin esta declaración TypeScript
 * no lo conoce y falla el chequeo.
 */
declare const __BACKEND_URL__: string | undefined
