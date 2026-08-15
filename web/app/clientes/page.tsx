import { listarClientes } from '@/lib/db/clientes'
import { FormCliente } from '@/components/ventas/FormCliente'

const OPERACION = 'CO'

export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const clientes = await listarClientes(OPERACION)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <h1 className="text-ink text-xl font-semibold">Clientes</h1>
        <p className="text-ink-subtle text-sm">
          A quién se le vende. El código es la clave de negocio: es la que va a viajar al
          sistema de facturación.
        </p>
      </div>

      <FormCliente />

      {clientes.length === 0 ? (
        <div className="border-line bg-surface rounded-lg border px-6 py-12 text-center">
          <p className="text-ink-subtle text-sm">Todavía no hay clientes.</p>
        </div>
      ) : (
        <div className="border-line bg-surface overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-ink-subtle text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Código</th>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Ciudad</th>
                <th className="px-3 py-2 font-medium">Contacto</th>
                <th className="px-3 py-2 text-right font-medium tabular-nums">Pedidos</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {clientes.map((c) => (
                <tr key={c.id} className="hover:bg-surface-hover">
                  <td className="text-ink-subtle px-3 py-2 text-xs tabular-nums">{c.code}</td>
                  <td className="text-ink px-3 py-2 font-medium">{c.name}</td>
                  <td className="text-ink-subtle px-3 py-2 text-xs">{c.city ?? '—'}</td>
                  <td className="text-ink-subtle px-3 py-2 text-xs">
                    {c.email ?? c.phone ?? '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      c.pedidos > 0 ? 'text-ink' : 'text-ink-muted'
                    }`}
                  >
                    {c.pedidos}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
