'use client'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="border-danger/30 bg-danger-bg rounded-lg border px-6 py-10 text-center">
      <p className="text-danger text-sm font-medium">No se pudo cargar el catálogo de pedido</p>
      <p className="text-ink-subtle mt-1 text-sm">{error.message}</p>
      <button
        onClick={reset}
        className="border-line bg-surface text-ink hover:bg-surface-hover mt-4 rounded-md border px-3 py-1.5 text-sm"
      >
        Reintentar
      </button>
    </div>
  )
}
