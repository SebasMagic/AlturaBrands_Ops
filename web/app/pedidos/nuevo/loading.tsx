export default function Cargando() {
  return (
    <div className="flex flex-col gap-y-4">
      <div className="bg-surface-subtle h-[76px] animate-pulse rounded-lg" />
      <div className="bg-surface-subtle h-[52px] animate-pulse rounded-lg" />
      <div className="border-line bg-surface rounded-lg border p-4">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="bg-surface-subtle mb-2 h-8 animate-pulse rounded" />
        ))}
      </div>
    </div>
  )
}
