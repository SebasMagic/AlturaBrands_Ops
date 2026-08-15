export type EtapaComercial = 'PROSPECTO' | 'COTIZADO' | 'NEGOCIACION' | 'GANADO' | 'PERDIDO'

/**
 * Las etapas del embudo comercial, en orden.
 *
 * A diferencia de Operaciones, estas NO se derivan de nada: son el juicio del
 * vendedor sobre dónde está la conversación. Por eso se pueden arrastrar.
 */
export const ETAPAS: {
  id: EtapaComercial
  label: string
  descripcion: string
  /** Cuenta para el total del embudo. GANADO ya no es pipeline, PERDIDO tampoco. */
  enPipeline: boolean
}[] = [
  { id: 'PROSPECTO', label: 'Prospecto', descripcion: 'Hay interés, todavía no hay números', enPipeline: true },
  { id: 'COTIZADO', label: 'Cotizado', descripcion: 'Se envió la cotización', enPipeline: true },
  { id: 'NEGOCIACION', label: 'Negociación', descripcion: 'Discutiendo precio, cantidades o plazos', enPipeline: true },
  { id: 'GANADO', label: 'Ganado', descripcion: 'Aceptó; pasa a Operaciones', enPipeline: false },
  { id: 'PERDIDO', label: 'Perdido', descripcion: 'No se cerró', enPipeline: false },
]

export const ETIQUETA: Record<EtapaComercial, string> = Object.fromEntries(
  ETAPAS.map((e) => [e.id, e.label])
) as Record<EtapaComercial, string>

/** Color con significado, consistente con el resto del ERP (CLAUDE.md §8). */
export const TONO: Record<EtapaComercial, string> = {
  PROSPECTO: 'text-ink-muted',
  COTIZADO: 'text-ink-subtle',
  NEGOCIACION: 'text-stock-transito',
  GANADO: 'text-stock-bodega',
  PERDIDO: 'text-danger',
}

export type Oportunidad = {
  id: number
  code: string
  cliente: string
  etapa: EtapaComercial
  status: 'COTIZACION' | 'CONFIRMADO' | 'CANCELADO'
  unidades: number
  valorCents: number
  diasSinAvanzar: number
  ordenTablero: number
}

export type ResumenEmbudo = {
  enPipelineCents: number
  enPipelineCount: number
  ganadoCents: number
  ganadoCount: number
  perdidoCount: number
  /** Cerradas ganadas sobre cerradas totales. Null si aún no se ha cerrado nada. */
  tasaCierre: number | null
}

/**
 * Resumen del embudo. Puro: se testea sin base de datos.
 *
 * El pipeline EXCLUYE ganado y perdido a propósito — mezclarlos infla la cifra
 * y hace creer que hay más por cerrar del que hay.
 */
export function calcularResumen(oportunidades: Oportunidad[]): ResumenEmbudo {
  const enPipeline = oportunidades.filter((o) => o.etapa !== 'GANADO' && o.etapa !== 'PERDIDO')
  const ganadas = oportunidades.filter((o) => o.etapa === 'GANADO')
  const perdidas = oportunidades.filter((o) => o.etapa === 'PERDIDO')
  const cerradas = ganadas.length + perdidas.length

  return {
    enPipelineCents: enPipeline.reduce((a, o) => a + o.valorCents, 0),
    enPipelineCount: enPipeline.length,
    ganadoCents: ganadas.reduce((a, o) => a + o.valorCents, 0),
    ganadoCount: ganadas.length,
    perdidoCount: perdidas.length,
    tasaCierre: cerradas === 0 ? null : Math.round((100 * ganadas.length) / cerradas),
  }
}

export function agruparPorEtapa(
  oportunidades: Oportunidad[]
): Record<EtapaComercial, Oportunidad[]> {
  const vacio = Object.fromEntries(ETAPAS.map((e) => [e.id, [] as Oportunidad[]])) as Record<
    EtapaComercial,
    Oportunidad[]
  >
  for (const o of oportunidades) {
    // Una etapa desconocida (por ejemplo tras añadir una nueva en la base sin
    // desplegar la app) no debe hacer desaparecer la tarjeta en silencio.
    if (vacio[o.etapa]) vacio[o.etapa].push(o)
  }
  for (const etapa of Object.keys(vacio) as EtapaComercial[]) {
    vacio[etapa].sort((a, b) => a.ordenTablero - b.ordenTablero || a.id - b.id)
  }
  return vacio
}
