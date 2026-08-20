import { NextResponse, type NextRequest } from 'next/server'
import { buscarVendible } from '@/lib/db/ventas'

const OPERACION = 'CO'

/**
 * Buscador de la proforma.
 *
 * Route Handler y no Server Action porque esto se llama mientras se teclea:
 * un GET es cancelable y no arrastra el ciclo de revalidación que sí tiene
 * sentido en una mutación.
 *
 * Sigue siendo código de SERVIDOR — el navegador nunca habla con Postgres
 * (CLAUDE.md §4) — y el middleware lo protege como a cualquier otra ruta.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''
  if (q.trim().length < 2) return NextResponse.json({ resultados: [] })

  try {
    const resultados = await buscarVendible(OPERACION, q)
    return NextResponse.json({ resultados })
  } catch (e) {
    return NextResponse.json(
      { resultados: [], error: e instanceof Error ? e.message : 'Error al buscar' },
      { status: 500 }
    )
  }
}
