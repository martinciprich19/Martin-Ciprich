import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SPL — Slovak Padel League',
    short_name: 'SPL',
    description: 'Hraj. Vyzývaj. Zlepšuj sa. Staň sa najlepším.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0f19',
    theme_color: '#bef264',
    icons: [
      {
        src: '/images/spl-logo-new.webp',
        sizes: '512x512',
        type: 'image/webp',
        purpose: 'any',
      },
    ],
  }
}
