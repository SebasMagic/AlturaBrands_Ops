import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { salirAction } from '@/app/login/actions'
import { autorizacionDe } from '@/lib/db/usuarios'
import { usuarioActual } from '@/lib/supabase/server'
import './globals.css'

export const metadata: Metadata = {
  title: 'AlturaBrands Ops',
  description: 'ERP operativo ligero — inventario, pedidos y despacho.',
  icons: { icon: '/altura.png' },
}

/**
 * Un ítem con `href: null` se pinta como «pronto» y no navega: un enlace a una
 * ruta que no existe es peor que no tener enlace (CLAUDE.md §7 — no ofrecer lo
 * que aún no está).
 */
const SECCIONES: { label: string; href: string | null }[] = [
  { label: 'Inventario', href: '/inventario' },
  { label: 'Pedidos', href: '/pedidos' },
  { label: 'Ventas', href: '/ventas' },
  { label: 'Clientes', href: '/clientes' },
  { label: 'Embudo', href: '/embudo' },
]

/** Rutas que se renderizan sin marco y sin exigir autorización. */
const SIN_MARCO = ['/login', '/sin-acceso']

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El middleware ya bloqueó el acceso sin sesión. Aquí se comprueba lo otro,
  // que el middleware no puede: que ese usuario esté AUTORIZADO.
  //
  // Va en el layout raíz a propósito — es el único punto por el que pasan
  // todas las páginas, así que una ruta nueva queda cubierta sola. El
  // middleware no sirve para esto: consultar Postgres desde el edge en cada
  // request sería caro y lento.
  let correo: string | null = null
  try {
    const usuario = await usuarioActual()
    correo = usuario?.email ?? null
  } catch {
    correo = null
  }

  const ruta = (await headers()).get('x-pathname') ?? ''
  const enPaginaLibre = SIN_MARCO.some((p) => ruta.startsWith(p))

  if (correo && !enPaginaLibre) {
    // Autenticado en Supabase no es lo mismo que autorizado aquí: el registro
    // público permite crear cuentas a cualquiera.
    const autorizado = await autorizacionDe(correo)
    if (!autorizado) redirect('/sin-acceso')
  }

  return (
    <html lang="es">
      <body className="antialiased">
        {correo ? (
          <div className="flex min-h-dvh flex-col">
            <header className="border-line bg-surface sticky top-0 z-10 border-b">
              <div className="flex items-center gap-x-6 px-6 py-2.5">
                <Link href="/inventario" className="flex shrink-0 items-center">
                  <Image
                    src="/altura.png"
                    alt="AlturaBrands"
                    width={512}
                    height={337}
                    priority
                    // Negro con fondo transparente: en modo oscuro se invierte
                    // a blanco, sin necesidad de una segunda versión del archivo.
                    className="h-7 w-auto dark:invert"
                  />
                </Link>

                <nav className="flex items-center gap-x-1">
                  {SECCIONES.map((s) =>
                    s.href ? (
                      <Link
                        key={s.label}
                        href={s.href}
                        className="text-ink-subtle hover:bg-surface-hover hover:text-ink rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                      >
                        {s.label}
                      </Link>
                    ) : (
                      <span
                        key={s.label}
                        className="text-ink-muted cursor-default rounded-md px-3 py-1.5 text-sm font-medium"
                        title="Todavía no construido"
                      >
                        {s.label} <span className="text-xs">· pronto</span>
                      </span>
                    )
                  )}
                </nav>

                <div className="ml-auto flex items-center gap-x-3">
                  <span className="text-ink-muted hidden text-xs sm:inline">{correo}</span>
                  <form action={salirAction}>
                    <button
                      type="submit"
                      className="text-ink-subtle hover:bg-surface-hover hover:text-ink rounded-md px-2.5 py-1.5 text-xs"
                    >
                      Salir
                    </button>
                  </form>
                </div>
              </div>
            </header>

            <main className="flex-1 px-6 py-4">{children}</main>
          </div>
        ) : (
          // Sin sesión sólo se renderiza `/login`, que trae su propio marco.
          children
        )}
      </body>
    </html>
  )
}
