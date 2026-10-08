import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'RIVA Padel',
    short_name: 'RIVA Padel',
    description: 'Hraj. Vyzývaj. Zlepšuj sa. Staň sa najlepším.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0f19',
    theme_color: '#bef264',
    icons: [
      {
        src: '/images/riva-padel-play-together-compact-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/images/riva-padel-play-together-compact-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  }
}
