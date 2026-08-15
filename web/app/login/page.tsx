import Image from 'next/image'
import { Suspense } from 'react'
import { FormLogin } from '@/components/FormLogin'

export const dynamic = 'force-dynamic'

/**
 * Pantalla de acceso.
 *
 * Es la única ruta pública (ver `middleware.ts`). El aviso de configuración
 * aparece sólo si faltan las claves: es el estado en que queda la app recién
 * clonada, y decirlo aquí ahorra un rato de depuración a ciegas.
 */
export default function LoginPage() {
  const sinConfigurar =
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Image
            src="/altura.png"
            alt="AlturaBrands"
            width={512}
            height={337}
            priority
            // El logo es negro con fondo transparente: en modo oscuro se
            // invierte a blanco en vez de mantener una versión aparte.
            className="h-auto w-52 dark:invert"
          />
        </div>

        <div className="border-line bg-surface rounded-lg border px-6 py-6">
          <h1 className="text-ink text-lg font-semibold">Entrar</h1>
          <p className="text-ink-subtle mt-0.5 mb-5 text-sm">
            Operación Colombia · ERP interno
          </p>

          {sinConfigurar ? (
            <div className="border-danger/30 bg-danger-bg rounded-md border px-4 py-3">
              <p className="text-danger text-sm font-medium">Falta configurar Supabase</p>
              <p className="text-ink-subtle mt-1 text-xs">
                Copia <code>NEXT_PUBLIC_SUPABASE_URL</code> y{' '}
                <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> del dashboard (Project Settings →
                API) a <code>web/.env.local</code>.
              </p>
            </div>
          ) : (
            <Suspense>
              <FormLogin />
            </Suspense>
          )}
        </div>

        <p className="text-ink-muted mt-6 text-center text-xs">
          Building Premium Brands
        </p>
      </div>
    </div>
  )
}
