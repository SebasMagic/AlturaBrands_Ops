import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Cliente de Supabase para código de servidor (Server Components, Server
 * Actions, Route Handlers).
 *
 * Se usa SOLO para identidad — quién es el usuario. Los datos del ERP siguen
 * leyéndose por `lib/db/*` con `pg` directo contra los schemas `ops`/`bi`
 * (CLAUDE.md §4: el navegador nunca habla con Postgres).
 *
 * Se crea uno por request y no se cachea: las cookies cambian entre peticiones
 * y un cliente compartido serviría la sesión de otro usuario.
 */
export async function crearClienteServidor() {
  const cookieStore = await cookies()

  return createServerClient(
    requerido('NEXT_PUBLIC_SUPABASE_URL'),
    requerido('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Un Server Component no puede escribir cookies. No es un error:
            // el refresco de sesión lo hace el middleware, que sí puede.
          }
        },
      },
    }
  )
}

function requerido(nombre: string): string {
  const valor = process.env[nombre]
  if (!valor) {
    throw new Error(
      `Falta ${nombre}. Cópiala del dashboard de Supabase (Project Settings → API) ` +
        'a web/.env.local. Ver web/.env.example.'
    )
  }
  return valor
}

/** El usuario de la sesión actual, o null. */
export async function usuarioActual() {
  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
