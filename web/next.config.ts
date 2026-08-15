import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // El repo tiene DOS pnpm-lock.yaml (el de Medusa en la raíz y el de esta
  // app): sin esto Turbopack infiere mal la raíz del workspace.
  turbopack: { root: __dirname },
  // La app es puramente interna: nada de imágenes remotas ni rewrites
  // especiales todavía. Se amplía cuando aparezca una necesidad real.
}

export default nextConfig
