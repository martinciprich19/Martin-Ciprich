'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { RivaLogo } from '@/components/riva-logo'
import { useLanguage } from '@/components/language-provider'
import { LeagueSelector } from '@/components/league-selector'

const navItems = [
  { label: 'Ako to funguje', englishLabel: 'How it works', href: '/how-it-works' },
  { label: 'Prebiehajúce zápasy', englishLabel: 'Live matches', href: '/live-matches' },
  { label: 'Rebríčky', englishLabel: 'Rankings', href: '/rankings' },
  { label: 'Turnaje', englishLabel: 'Tournaments', href: '/tournaments' },
]

export function PublicShell({ children, showAuthLinks = true, showMenuButton = true, logoHref = '/', kioskMode = false, signedIn = false }: {
  children: React.ReactNode
  showAuthLinks?: boolean
  showMenuButton?: boolean
  logoHref?: string
  kioskMode?: boolean
  signedIn?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { t } = useLanguage()
  const brandHref = kioskMode ? '/match' : signedIn ? '/profile' : logoHref

  return (
    <main className="photo-layout relative isolate min-h-screen text-app-fg">
      <div className="fixed inset-0 -z-20 bg-[url('/padel-hero.png')] bg-cover bg-[position:68%_center] opacity-35" />
      <div className="public-backdrop fixed inset-0 -z-10" />
      <header className="photo-navigation theme-surface relative mx-auto flex w-full max-w-[1260px] flex-wrap items-center justify-between gap-3 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Link href={brandHref} aria-label={kioskMode ? 'RIVA Padel kiosk' : brandHref === '/' ? 'RIVA Padel domov' : 'RIVA Padel prehľad'}><RivaLogo size="header" /></Link>
        <nav className="order-last hidden w-full items-center justify-center gap-7 lg:flex" aria-label={t('Hlavná navigácia', 'Main navigation')}>
          {navItems.map((item) => <Link key={item.href} href={item.href} className="text-[11px] font-medium text-app-fg/70 transition hover:text-app-accent">{t(item.label, item.englishLabel)}</Link>)}
        </nav>
        <div className="flex max-w-full flex-wrap items-center gap-2 lg:gap-3">
          {!kioskMode ? <LeagueSelector /> : null}
          {showAuthLinks && !kioskMode && !signedIn ? <>
          <Link href="/auth/login" className="whitespace-nowrap rounded-lg border border-app-line/15 px-3 py-2 text-[10px] font-semibold text-app-fg transition hover:border-app-line/35 sm:px-4 sm:py-2.5 sm:text-[11px]">Prihlásiť sa</Link>
          <Link href="/auth/sign-up" className="whitespace-nowrap rounded-lg bg-[#a8e63c] px-3 py-2 text-[10px] font-bold text-[#061016] transition hover:bg-[#c1fa66] sm:px-4 sm:py-2.5 sm:text-[11px]">Registrovať sa</Link>
          </> : null}
          {showMenuButton ? <button className="rounded-lg border border-app-line/15 p-1.5 text-app-fg sm:p-2.5 lg:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Zavrieť menu' : 'Otvoriť menu'}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button> : null}
        </div>
      </header>

      {showMenuButton && menuOpen && <div className="mx-6 rounded-2xl border border-app-line/10 bg-app-court/95 p-5 backdrop-blur lg:hidden"><nav className="flex flex-col gap-4">{navItems.map((item) => <Link onClick={() => setMenuOpen(false)} key={item.href} href={item.href} className="text-sm text-app-fg/80">{t(item.label, item.englishLabel)}</Link>)}</nav></div>}

      <section className="px-6 pb-20 pt-6 lg:px-10 lg:pb-28">{children}</section>
    </main>
  )
}
