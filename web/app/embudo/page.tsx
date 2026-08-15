import { listarOportunidades } from '@/lib/db/comercial'
import { Tablero } from '@/components/embudo/Tablero'

const OPERACION = 'CO'

export const dynamic = 'force-dynamic'

/**
 * Embudo comercial.
 *
 * Distinto de Operaciones a propósito: allí la etapa se DERIVA de hechos
 * (reservas, despachos) y por eso no se puede arrastrar. Aquí la etapa es el
 * juicio del vendedor sobre dónde está la conversación — no hay ningún hecho
 * del que deducirla, así que se guarda y se arrastra.
 */
export default async function EmbudoPage() {
  const oportunidades = await listarOportunidades(OPERACION)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="border-line bg-surface rounded-lg border px-6 py-4">
        <h1 className="text-ink text-xl font-semibold">Embudo</h1>
        <p className="text-ink-subtle text-sm">
          Dónde está cada oportunidad comercial. Al soltar en <strong>Ganado</strong> el
          pedido pasa a firme y aparece en Operaciones; en <strong>Perdido</strong> se
          cancela y se libera el inventario reservado.
        </p>
      </div>

      <Tablero inicial={oportunidades} />
    </div>
  )
}
