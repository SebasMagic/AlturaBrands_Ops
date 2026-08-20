import { NextResponse, type NextRequest } from 'next/server'
import { obtenerFichaProducto } from '@/lib/db/ventas'

const OPERACION = 'CO'

/** Ficha rápida para confirmar el producto sin salir de la proforma. */
export async function GET(request: NextRequest) {
  const material = request.nextUrl.searchParams.get('material')
  if (!material) return NextResponse.json({ ficha: null }, { status: 400 })

  try {
    const ficha = await obtenerFichaProducto(OPERACION, material)
    if (!ficha) return NextResponse.json({ ficha: null }, { status: 404 })
    return NextResponse.json({ ficha })
  } catch (e) {
    return NextResponse.json(
      { ficha: null, error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    )
  }
}
