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
  title: 'SPL — Slovak Padel League',
  description: 'Hraj. Vyzývaj. Zlepšuj sa. Staň sa najlepším.',
  applicationName: 'SPL',
  appleWebApp: {
    capable: true,
    title: 'SPL',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [{ url: '/images/spl-logo-new.webp', type: 'image/webp', sizes: '512x512' }],
    apple: [{ url: '/images/spl-logo-new.webp', type: 'image/webp', sizes: '512x512' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#bef264',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sk" className={inter.variable}><body><LanguageProvider>{children}</LanguageProvider></body></html>
}
