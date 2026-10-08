'use client'

import { ArrowRight, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { RivaLogo } from '@/components/riva-logo'
import { InstallAppButton } from '@/components/install-app-button'
import { useLanguage } from '@/components/language-provider'

const navItems = [
  { label: 'Ako to funguje', href: '/how-it-works' },
  { label: 'Rebríčky', href: '/rankings' },
  { label: 'Turnaje', href: '/tournaments' },
]


export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { t } = useLanguage()
  const localizedNavItems = navItems.map((item) => ({ ...item, label: t(item.label) }))

  return (
    <main className="min-h-screen overflow-hidden bg-[#061016]">
      <section className="relative isolate min-h-screen min-h-[100svh] border-b border-white/10">
        <div className="absolute inset-0 -z-20 bg-[#061016]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#061016_0%,rgba(6,16,22,.96)_29%,rgba(6,16,22,.53)_58%,rgba(6,16,22,.25)_100%)]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(3,8,12,.35),transparent_35%,#061016_100%)]" />
        <div className="absolute inset-0 -z-10 bg-[url('/padel-hero.png')] bg-cover bg-[position:68%_center] opacity-90" />
        <div className="hero-noise absolute inset-0 -z-10 opacity-30" />

        <header className="mx-auto flex w-full max-w-[1260px] items-center justify-between gap-3 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <Link href="/" className="group flex items-center gap-3" aria-label={t('RIVA Padel domov', 'RIVA Padel home')}>
            <RivaLogo size="header" />
          </Link>

          <nav className="hidden items-center gap-7 lg:flex" aria-label="Hlavná navigácia">
            {localizedNavItems.map((item) => <Link key={item.label} prefetch href={item.href} className="text-[11px] font-medium text-white/70 transition hover:text-[#a8e63c]">{item.label}</Link>)}
          </nav>

          <div className="flex shrink-0 items-center gap-2 lg:gap-3">
            <Link href="/auth/login" className="whitespace-nowrap rounded-lg border border-white/15 px-3 py-2 text-[10px] font-semibold text-white transition hover:border-white/35 sm:px-4 sm:py-2.5 sm:text-[11px]">{t('Prihlásiť sa')}</Link>
            <Link href="/auth/sign-up" className="whitespace-nowrap rounded-lg bg-[#a8e63c] px-3 py-2 text-[10px] font-bold text-[#061016] transition hover:bg-[#c1fa66] sm:px-4 sm:py-2.5 sm:text-[11px]">{t('Registrovať sa')}</Link>
            <button className="rounded-lg border border-white/15 p-1.5 text-white sm:p-2.5 lg:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Zavrieť menu' : 'Otvoriť menu'}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </header>

        {menuOpen && <div className="mx-6 rounded-2xl border border-white/10 bg-[#0b1b22]/95 p-5 backdrop-blur lg:hidden"><nav className="flex flex-col gap-4">{localizedNavItems.map((item) => <Link onClick={() => setMenuOpen(false)} key={item.label} href={item.href} className="text-sm text-white/80">{item.label}</Link>)}</nav></div>}

        <div className="mx-auto flex w-full max-w-[1260px] px-6 pb-24 pt-20 lg:px-10 lg:pb-32 lg:pt-28">
          <div className="max-w-[590px]">
            <p className="mb-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-[#a8e63c]"><span className="h-px w-8 bg-[#a8e63c]" /> {t('RIVA Padel')}</p>
            <h1 className="text-[46px] font-black uppercase leading-[.94] tracking-[-.05em] text-white sm:text-[64px] lg:text-[76px]">{t('Hraj.')}<br /><span className="text-[#a8e63c]">{t('Vyzývaj.')}</span><br /><span className="text-[#a8e63c]">{t('Zlepšuj sa.')}</span><br />{t('Staň sa najlepším.')}</h1>
            <p className="mt-7 max-w-[390px] text-[14px] leading-6 text-white/60">{t('RIVA Padel je aplikácia pre padelových hráčov. Zbieraj body, zlepšuj svoj rebríček, vyzývaj súperov a hraj o skvelé ceny.', 'RIVA Padel is an app for padel players. Earn points, climb the rankings, challenge opponents and play for great prizes.')}</p>
            <div className="relative -top-[20px] mt-8 flex flex-wrap gap-3"><Link href="/auth/sign-up" className="group flex items-center gap-3 rounded-lg bg-[#a8e63c] px-5 py-3.5 text-xs font-bold text-[#061016] transition hover:bg-[#c1fa66]">{t('Stať sa členom')} <ArrowRight size={16} className="transition group-hover:translate-x-1" /></Link><InstallAppButton showWhenInstalled /></div>
          </div>
        </div>

      </section>
      <footer className="border-t border-white/10 px-6 py-7 text-center text-[10px] uppercase tracking-[.18em] text-white/30">RIVA Padel</footer>
    </main>
  )
}
