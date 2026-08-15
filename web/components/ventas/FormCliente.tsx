'use client'

import { useState, useTransition } from 'react'
import { crearClienteAction } from '@/app/ventas/acciones'

const campo =
  'border-line bg-surface text-ink placeholder:text-ink-muted focus:border-interactive focus:ring-interactive/30 w-full rounded-md border px-3 py-1.5 text-sm outline-none focus:ring-2'

export function FormCliente() {
  const [abierto, setAbierto] = useState(false)
  const [pendiente, startTransition] = useTransition()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; mensaje: string } | null>(null)

  const enviar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const form = e.currentTarget
    setAviso(null)
    startTransition(async () => {
      const r = await crearClienteAction({
        code: String(fd.get('code') ?? ''),
        name: String(fd.get('name') ?? ''),
        taxId: String(fd.get('taxId') ?? ''),
        email: String(fd.get('email') ?? ''),
        phone: String(fd.get('phone') ?? ''),
        city: String(fd.get('city') ?? ''),
      })
      if (r.ok) {
        setAviso({ tipo: 'ok', mensaje: 'Cliente creado.' })
        form.reset()
        setAbierto(false)
      } else {
        setAviso({ tipo: 'error', mensaje: r.error })
      }
    })
  }

  if (!abierto) {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => setAbierto(true)}
          className="bg-interactive rounded-md px-4 py-1.5 text-sm font-medium text-white"
        >
          Nuevo cliente
        </button>
        {aviso?.tipo === 'ok' && <span className="text-stock-bodega text-sm">{aviso.mensaje}</span>}
      </div>
    )
  }

  return (
    <form onSubmit={enviar} className="border-line bg-surface flex flex-col gap-3 rounded-lg border px-4 py-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="text-ink-subtle mb-1 block text-xs">Código / NIT *</label>
          <input name="code" required className={campo} placeholder="900123456" />
        </div>
        <div className="md:col-span-2">
          <label className="text-ink-subtle mb-1 block text-xs">Nombre *</label>
          <input name="name" required className={campo} placeholder="Calzado del Norte S.A.S." />
        </div>
        <div>
          <label className="text-ink-subtle mb-1 block text-xs">NIT para facturar</label>
          <input name="taxId" className={campo} />
        </div>
        <div>
          <label className="text-ink-subtle mb-1 block text-xs">Ciudad</label>
          <input name="city" className={campo} />
        </div>
        <div>
          <label className="text-ink-subtle mb-1 block text-xs">Teléfono</label>
          <input name="phone" className={campo} />
        </div>
        <div className="md:col-span-2">
          <label className="text-ink-subtle mb-1 block text-xs">Correo</label>
          <input name="email" type="email" className={campo} />
        </div>
      </div>

      {aviso?.tipo === 'error' && (
        <p className="border-danger/30 bg-danger-bg text-danger rounded-md border px-3 py-2 text-sm">
          {aviso.mensaje}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pendiente}
          className="bg-interactive rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={() => { setAbierto(false); setAviso(null) }}
          className="border-line text-ink-subtle hover:bg-surface-hover rounded-md border px-4 py-1.5 text-sm"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
