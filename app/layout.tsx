import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { LanguageProvider } from '@/components/language-provider'

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'RIVA Padel',
  description: 'Hraj. Vyzývaj. Zlepšuj sa. Staň sa najlepším.',
  applicationName: 'RIVA Padel',
  appleWebApp: {
    capable: true,
    title: 'RIVA Padel',
    statusBarStyle: 'default',
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
  icons: {
    icon: [{ url: '/images/riva-padel-play-together-compact-icon-192.png', type: 'image/png', sizes: '192x192' }],
    apple: [{ url: '/images/riva-padel-play-together-compact-apple-touch-icon.png', type: 'image/png', sizes: '180x180' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#bef264',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sk" className={`${inter.variable} dark`} suppressHydrationWarning><body><LanguageProvider>{children}</LanguageProvider></body></html>
}
