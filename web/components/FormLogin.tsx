'use client'

import { useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { entrarAction } from '@/app/login/actions'

export function FormLogin() {
  const searchParams = useSearchParams()
  const desde = searchParams.get('desde') ?? ''
  const [pendiente, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const enviar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)
    startTransition(async () => {
      // Si entra, la acción hace `redirect` y esto nunca resuelve.
      const r = await entrarAction(fd)
      if (r && !r.ok) setError(r.error)
    })
  }

  const campo =
    'border-line bg-surface text-ink placeholder:text-ink-muted focus:border-interactive focus:ring-interactive/30 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2'

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <input type="hidden" name="desde" value={desde} />

      <div>
        <label htmlFor="email" className="text-ink-subtle mb-1 block text-xs">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          className={campo}
        />
      </div>

      <div>
        <label htmlFor="password" className="text-ink-subtle mb-1 block text-xs">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={campo}
        />
      </div>

      {error && (
        <p className="border-danger/30 bg-danger-bg text-danger rounded-md border px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="bg-interactive rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pendiente ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
