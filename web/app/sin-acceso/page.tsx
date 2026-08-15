import Image from 'next/image'
import { salirAction } from '@/app/login/actions'

export const dynamic = 'force-dynamic'

/**
 * Autenticado en Supabase, pero no autorizado en este ERP.
 *
 * Es el caso de quien se crea una cuenta por su cuenta: la sesión es válida,
 * pero su correo no está en `ops.app_user`. Se le dice con claridad y se le
 * ofrece salir — no se le deja en un bucle de redirecciones.
 */
export default function SinAccesoPage() {
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
            className="h-auto w-52 dark:invert"
          />
        </div>

        <div className="border-line bg-surface rounded-lg border px-6 py-6 text-center">
          <h1 className="text-ink text-lg font-semibold">Sin acceso</h1>
          <p className="text-ink-subtle mt-2 text-sm">
            Tu cuenta es válida, pero este correo no está autorizado para entrar al ERP.
            Pídele a un administrador que te dé de alta.
          </p>

          <form action={salirAction} className="mt-5">
            <button
              type="submit"
              className="border-line text-ink-subtle hover:bg-surface-hover hover:text-ink rounded-md border px-4 py-1.5 text-sm"
            >
              Salir
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
