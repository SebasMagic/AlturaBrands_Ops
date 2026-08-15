import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { estaAutorizado } from '@/lib/autorizacion'

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
/**
 * `/sin-acceso` va aquí para que quien no está autorizado pueda ver la página
 * que se lo explica, en vez de rebotar en un bucle de redirecciones hacia
 * ella misma. No expone nada: es texto y un botón de salir.
 */
const PUBLICAS = ['/login', '/auth', '/sin-acceso']

export async function middleware(request: NextRequest) {
  /**
   * Next no expone la ruta a un Server Component. Se pasa por cabecera porque
   * el layout raíz la necesita para no exigir autorización en `/login` ni en
   * `/sin-acceso` — sin esto, quien no está autorizado entra en un bucle de
   * redirecciones hacia la propia página que se lo explica.
   */
  request.headers.set('x-pathname', request.nextUrl.pathname)
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

  /**
   * Autenticado no es lo mismo que autorizado.
   *
   * El registro público de Supabase Auth está abierto: cualquiera puede crear
   * una cuenta con su correo. Sin esta comprobación, confirmarla daría acceso
   * al ERP entero. Tiene que ocurrir AQUÍ y no en el layout: allí la página ya
   * se ha renderizado y sus datos viajan en el cuerpo del redirect.
   */
  if (user && !esPublica(request.nextUrl.pathname)) {
    const autorizado = await estaAutorizado(user.email ?? '', Date.now())
    if (!autorizado) {
      return NextResponse.redirect(new URL('/sin-acceso', request.url))
    }
  }

  // Ya autenticado y autorizado, el login no tiene sentido.
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
   * Node y no edge: la comprobación de autorización consulta Postgres con `pg`,
   * que no corre en el runtime edge.
   */
  runtime: 'nodejs',
  /**
   * Todo menos estáticos y el logo. Sin excluirlos, cada imagen dispararía una
   * validación de token contra Supabase.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|altura.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
