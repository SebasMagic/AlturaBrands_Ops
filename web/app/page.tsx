import { redirect } from 'next/navigation'

/** Inventario es la puerta de entrada: es la pantalla del día a día. */
export default function Home() {
  redirect('/inventario')
}
