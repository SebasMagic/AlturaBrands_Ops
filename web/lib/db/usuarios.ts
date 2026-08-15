import { getPool } from './pool'

export type Rol = 'ADMIN' | 'COMERCIAL' | 'BODEGA' | 'OPERACION'

export type UsuarioAutorizado = {
  email: string
  nombre: string
  rol: Rol
}

/**
 * Comprueba que un correo autenticado corresponde a alguien AUTORIZADO.
 *
 * Estar autenticado en Supabase no basta. El registro público de Supabase Auth
 * permite que cualquiera cree una cuenta; sin esta comprobación, confirmar un
 * correo cualquiera daría acceso al ERP entero.
 *
 * Devuelve null si no está en la tabla o está desactivado — el llamador debe
 * tratar ambos casos como "no puede entrar".
 */
export async function autorizacionDe(email: string | null | undefined): Promise<UsuarioAutorizado | null> {
  if (!email) return null

  const pool = getPool()
  const { rows } = await pool.query(
    `select email, nombre, rol from ops.app_user
      where email = lower(trim($1)) and is_active`,
    [email]
  )

  const u = rows[0]
  return u ? { email: u.email, nombre: u.nombre, rol: u.rol } : null
}
