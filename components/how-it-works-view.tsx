'use client'

import { ArrowRight, Globe2, Gauge, Medal, Menu, ShieldCheck, Trophy, X } from 'lucide-react'
import Link from 'next/link'
import { RivaLogo } from '@/components/riva-logo'
import { useState } from 'react'
import { useLanguage } from '@/components/language-provider'
import { PageReloadButton } from '@/components/page-reload-button'

const navItems = [
  { label: 'Ako to funguje', href: '/how-it-works' },
  { label: 'Rebríčky', href: '/rankings' },
  { label: 'Turnaje', href: '/tournaments' },
]

const steps = [
  { icon: Globe2, step: '01', title: 'Celonárodná komunitná sieť', text: 'Prepoj sa s hráčmi a padelovými arénami po celej krajine. Vyzývaj súperov v ľubovoľnom regióne bez ohľadu na úroveň.' },
  { icon: Gauge, step: '02', title: 'Dynamický ELO rating', text: 'Každý overený zápas mení tvoju pozíciu v rebríčku. Výhra pridá body, prehra ich odoberie podľa sily súpera.' },
  { icon: Medal, step: '03', title: '6-mesačné sezóny', text: 'Hraj v pravidelných ligových cykloch. Top 3 hráči celoštátneho aj krajského rebríčka získajú ocenenia.' },
  { icon: Trophy, step: '04', title: 'Oficiálne RIVA turnaje', text: 'Zúčastni sa pravidelných turnajov, získaj špeciálne ocenenia a bonusové body za víťazstvo.' },
  { icon: ShieldCheck, step: '05', title: 'Férové overenie výsledkov', text: 'Výsledok zapíše jedna dvojica a druhá ho potvrdí priamo v aplikácii. Body sa pripíšu až po obojstrannom schválení.' },
]

export default function HowItWorksView({ kioskMode, signedIn = false }: { kioskMode: boolean; signedIn?: boolean }) {
  const { t } = useLanguage()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <main className="photo-layout relative isolate min-h-screen text-app-fg">
      <div className="fixed inset-0 -z-20 bg-[url('/padel-hero.png')] bg-cover bg-[position:68%_center] opacity-35" />
      <div className="public-backdrop fixed inset-0 -z-10" />
      <header className="photo-navigation theme-surface mx-auto flex w-full max-w-[1260px] flex-wrap items-center justify-between gap-3 px-4 py-6 sm:flex-nowrap sm:px-6 lg:px-10 lg:py-8">
        <Link href={kioskMode ? '/match' : signedIn ? '/profile' : '/'} className="group flex items-center gap-3" aria-label={t(kioskMode ? 'RIVA Padel kiosk' : signedIn ? 'RIVA Padel prehľad' : 'RIVA Padel domov')}>
          <RivaLogo size="header" />
        </Link>
        <nav className="hidden items-center gap-7 lg:flex" aria-label={t('Hlavná navigácia')}>
          {navItems.map((item) => <Link key={item.label} href={item.href} className="text-[11px] font-medium text-app-fg/70 transition hover:text-app-accent">{t(item.label)}</Link>)}
        </nav>
        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          <PageReloadButton />
          {!kioskMode && !signedIn ? <>
            <Link href="/auth/login" className="whitespace-nowrap rounded-lg border border-app-line/15 px-3 py-2 text-[10px] font-semibold text-app-fg transition hover:border-app-line/35 sm:px-4 sm:py-2.5 sm:text-[11px]">{t('Prihlásiť sa')}</Link>
            <Link href="/auth/sign-up" className="whitespace-nowrap rounded-lg bg-[#a8e63c] px-3 py-2 text-[10px] font-bold text-[#061016] transition hover:bg-[#c1fa66] sm:px-4 sm:py-2.5 sm:text-[11px]">{t('Registrovať sa')}</Link>
          </> : null}
          <button className="rounded-lg border border-app-line/15 p-1.5 text-app-fg sm:p-2.5 lg:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} aria-label={t(menuOpen ? 'Zavrieť menu' : 'Otvoriť menu')}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </header>

      {menuOpen && <div className="mx-6 rounded-2xl border border-app-line/10 bg-app-court/95 p-5 backdrop-blur lg:hidden"><nav className="flex flex-col gap-4">{navItems.map((item) => <Link onClick={() => setMenuOpen(false)} key={item.label} href={item.href} className="text-sm text-app-fg/80">{t(item.label)}</Link>)}</nav></div>}

      <section className="mx-auto max-w-[1260px] px-6 pb-20 pt-10 lg:px-10 lg:pb-28 lg:pt-12">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-app-accent"><span className="h-px w-8 bg-[#a8e63c]" /> {t('Ako to funguje')}</p>
          <h1 className="mt-4 text-4xl font-black uppercase leading-[.95] tracking-[-.05em] sm:text-6xl">{t('Viac zápasov.')}<br /><span className="text-app-accent">{t('Lepší hráč.')}</span></h1>
          <p className="mt-6 max-w-xl text-sm leading-7 text-app-fg/55">{t('RIVA Padel spája hráčov, arény a súťaživý padel do jednej férovej komunity.')}</p>
        </div>
        <div id="features" className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map(({ icon: Icon, step, title, text }) => <article key={step} className="group rounded-xl border border-app-line/10 bg-app-court p-6 transition hover:-translate-y-1 hover:border-[#a8e63c]/50"><div className="flex items-start justify-between"><div className="flex size-11 items-center justify-center rounded-xl border border-[#a8e63c]/25 bg-[#a8e63c]/10 text-app-accent"><Icon size={20} /></div><span className="text-xs font-bold tracking-[.2em] text-app-fg/25">{step}</span></div><h2 className="mt-7 text-base font-bold text-app-fg">{t(title)}</h2><p className="mt-3 text-sm leading-6 text-app-fg/45">{t(text)}</p></article>)}
        </div>
        {!kioskMode && !signedIn && <div className="mt-12 flex justify-center"><Link href="/auth/sign-up" className="group flex items-center gap-3 rounded-lg bg-[#a8e63c] px-7 py-4 text-sm font-bold text-[#061016] transition hover:bg-[#c1fa66]">{t('Registrovať sa a začať hrať')} <ArrowRight size={18} className="transition group-hover:translate-x-1" /></Link></div>}
      </section>
    </main>
  )
}
