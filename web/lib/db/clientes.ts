import { getPool } from './pool'

export type Cliente = {
  id: number
  code: string
  name: string
  taxId: string | null
  email: string | null
  phone: string | null
  city: string | null
  isActive: boolean
  pedidos: number
}

export async function listarClientes(operacion: string): Promise<Cliente[]> {
  const pool = getPool()
  const { rows } = await pool.query(
    `select c.id, c.code, c.name, c.tax_id, c.email, c.phone, c.city, c.is_active,
            count(so.id)::int as pedidos
       from ops.customer c
       join ops.operation o on o.id = c.operation_id
       left join ops.sales_order so on so.customer_id = c.id
      where o.code = $1
      group by c.id
      order by c.name`,
    [operacion]
  )
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    taxId: r.tax_id,
    email: r.email,
    phone: r.phone,
    city: r.city,
    isActive: r.is_active,
    pedidos: r.pedidos,
  }))
}

export type NuevoCliente = {
  code: string
  name: string
  taxId?: string
  email?: string
  phone?: string
  city?: string
}

export async function crearCliente(
  operacion: string,
  datos: NuevoCliente
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const pool = getPool()
  try {
    const { rows: op } = await pool.query('select id from ops.operation where code = $1', [operacion])
    if (!op[0]) return { ok: false, error: `Operación desconocida: ${operacion}` }

    const { rows } = await pool.query(
      `insert into ops.customer (code, name, tax_id, email, phone, city, operation_id)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        datos.code.trim(),
        datos.name.trim(),
        datos.taxId?.trim() || null,
        datos.email?.trim() || null,
        datos.phone?.trim() || null,
        datos.city?.trim() || null,
        op[0].id,
      ]
    )
    return { ok: true, id: rows[0].id }
  } catch (e) {
    // 23505 = unique_violation. El código es clave de negocio y se escribe a
    // mano, así que chocar es un caso normal, no un fallo del sistema.
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505') {
      return { ok: false, error: `Ya existe un cliente con el código ${datos.code}.` }
    }
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo crear el cliente' }
  }
}
