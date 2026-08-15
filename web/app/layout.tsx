import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { salirAction } from '@/app/login/actions'
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El middleware ya bloqueó el acceso sin sesión; esto es sólo para pintar
  // quién está dentro. Si Supabase no está configurado, `usuarioActual` lanza
  // y la app queda en el login con su aviso.
  let correo: string | null = null
  try {
    const usuario = await usuarioActual()
    correo = usuario?.email ?? null
  } catch {
    correo = null
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
