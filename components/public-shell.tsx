'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { SplLogo } from '@/components/spl-logo'

const navItems = [
  { label: 'Ako to funguje', href: '/how-it-works' },
  { label: 'Rebríčky', href: '/rankings' },
  { label: 'Turnaje', href: '/tournaments' },
]

export function PublicShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <main className="relative isolate min-h-screen bg-[#061016] text-white">
      <div className="fixed inset-0 -z-20 bg-[url('/padel-hero.png')] bg-cover bg-[position:68%_center] opacity-35" />
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(90deg,#061016_0%,rgba(6,16,22,.85)_40%,rgba(6,16,22,.6)_100%)]" />
      <header className="mx-auto flex w-full max-w-[1260px] items-center justify-between gap-3 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Link href="/" aria-label="SPL domov"><SplLogo size="header" /></Link>
        <nav className="hidden items-center gap-7 lg:flex" aria-label="Hlavná navigácia">
          {navItems.map((item) => <Link key={item.label} href={item.href} className="text-[11px] font-medium text-white/70 transition hover:text-[#a8e63c]">{item.label}</Link>)}
        </nav>
        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          <Link href="/auth/login" className="whitespace-nowrap rounded-lg border border-white/15 px-3 py-2 text-[10px] font-semibold text-white transition hover:border-white/35 sm:px-4 sm:py-2.5 sm:text-[11px]">Prihlásiť sa</Link>
          <Link href="/auth/sign-up" className="whitespace-nowrap rounded-lg bg-[#a8e63c] px-3 py-2 text-[10px] font-bold text-[#061016] transition hover:bg-[#c1fa66] sm:px-4 sm:py-2.5 sm:text-[11px]">Registrovať sa</Link>
          <button className="rounded-lg border border-white/15 p-1.5 text-white sm:p-2.5 lg:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Zavrieť menu' : 'Otvoriť menu'}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </header>

      {menuOpen && <div className="mx-6 rounded-2xl border border-white/10 bg-[#0b1b22]/95 p-5 backdrop-blur lg:hidden"><nav className="flex flex-col gap-4">{navItems.map((item) => <Link onClick={() => setMenuOpen(false)} key={item.label} href={item.href} className="text-sm text-white/80">{item.label}</Link>)}</nav></div>}

      <section className="px-6 pb-20 pt-6 lg:px-10 lg:pb-28">{children}</section>
    </main>
  )
}
