'use client'

import { RefreshCw } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/components/language-provider'

export function PageReloadButton() {
  const { t } = useLanguage()
  const label = t('Obnoviť stránku', 'Reload page')

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-app-line/25 bg-app-court text-app-accent transition hover:border-app-accent hover:bg-app-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      <RefreshCw size={21} aria-hidden="true" />
    </button>
  )
}

const pagesWithReloadHeader = new Set(['/', '/profile', '/how-it-works', '/match', '/live-matches', '/rankings', '/tournaments'])

export function PageReloadToolbar() {
  const pathname = usePathname()
  if (pagesWithReloadHeader.has(pathname) || pathname.startsWith('/scoreboard/') || pathname.startsWith('/kiosk-preview/')) return null

  return (
    <div className="flex min-h-14 items-center justify-end border-b border-app-line/10 bg-app-canvas px-4 py-1">
      <PageReloadButton />
    </div>
  )
}
