/**
 * Next la muestra automáticamente mientras el Server Component de la página
 * espera la consulta — no hace falta un estado `cargando` a mano como en la
 * versión con `fetch` desde el cliente.
 */
export default function Cargando() {
  return (
    <div className="flex flex-col gap-y-3">
      <div className="bg-surface-subtle h-[76px] animate-pulse rounded-lg" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-surface-subtle h-[72px] animate-pulse rounded-lg" />
        ))}
      </div>
      <div className="bg-surface-subtle h-[52px] animate-pulse rounded-lg" />
      <div className="border-line bg-surface rounded-lg border p-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="bg-surface-subtle mb-2 h-12 animate-pulse rounded" />
        ))}
      </div>
    </div>
  )
}
