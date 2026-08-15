import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Guarda de sesión para toda la aplicación.
 *
 * Hace dos cosas en cada request:
 *   1. Refresca el token de Supabase y reescribe las cookies. Un Server
 *      Component no puede escribir cookies, así que si esto no ocurriera aquí
 *      la sesión caducaría a los 60 minutos y el usuario saldría solo.
 *   2. Bloquea todo lo que no sea `/login`. La lista es de PERMITIDOS, no de
 *      bloqueados: una ruta nueva queda protegida por defecto, que es el
 *      comportamiento seguro cuando alguien olvida actualizar esta lista.
 *
 * `getUser()` y no `getSession()`: `getSession` sólo lee la cookie, que el
 * navegador puede falsificar. `getUser` valida el token contra Supabase.
 */
const PUBLICAS = ['/login', '/auth']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Sin credenciales configuradas no se puede validar a nadie. Se deja pasar
  // sólo el login, que muestra el aviso de configuración: fallar hacia el
  // login es lo seguro; dejar entrar sin poder comprobar quién es, no.
  if (!url || !key) {
    return esPublica(request.nextUrl.pathname)
      ? response
      : redirigirALogin(request)
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !esPublica(request.nextUrl.pathname)) {
    return redirigirALogin(request)
  }

  // Ya autenticado, el login no tiene sentido.
  if (user && request.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/inventario', request.url))
  }

  return response
}

function esPublica(pathname: string): boolean {
  return PUBLICAS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function redirigirALogin(request: NextRequest) {
  const destino = new URL('/login', request.url)
  // Se recuerda a dónde iba para devolverlo ahí tras entrar.
  if (request.nextUrl.pathname !== '/') {
    destino.searchParams.set('desde', request.nextUrl.pathname)
  }
  return NextResponse.redirect(destino)
}

export const config = {
  /**
   * Todo menos estáticos y el logo. Sin excluirlos, cada imagen dispararía una
   * validación de token contra Supabase.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|altura.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
