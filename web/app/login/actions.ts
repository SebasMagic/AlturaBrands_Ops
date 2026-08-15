'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@/lib/supabase/server'

export type ResultadoLogin = { ok: false; error: string }

/**
 * Entrar con correo y contraseña.
 *
 * En caso de éxito NO devuelve: hace `redirect`, que lanza una excepción
 * especial de Next. Por eso el tipo de retorno sólo contempla el fallo.
 */
export async function entrarAction(formData: FormData): Promise<ResultadoLogin> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const desde = String(formData.get('desde') ?? '') || '/inventario'

  if (!email || !password) {
    return { ok: false, error: 'Escribe tu correo y tu contraseña.' }
  }

  let supabase
  try {
    supabase = await crearClienteServidor()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Supabase no está configurado.' }
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // No se distingue "usuario no existe" de "contraseña incorrecta": decirlo
    // permitiría averiguar qué correos tienen cuenta.
    return { ok: false, error: 'Correo o contraseña incorrectos.' }
  }

  revalidatePath('/', 'layout')
  redirect(desde)
}

export async function salirAction() {
  const supabase = await crearClienteServidor()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
