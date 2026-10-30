'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronRight, MapPin, Trophy, Users, X } from 'lucide-react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { useLeague } from '@/components/league-provider'
import { useLanguage } from '@/components/language-provider'
import type { CountryCode } from '@/lib/countries'
import { fetchLeaguePlayers } from '@/lib/players'

type Category = 'BEGINNER' | 'INTERMEDIATE' | 'OPEN' | 'MIX' | 'PRO'
type TournamentStatus = 'OPEN' | 'FULL' | 'IN_PROGRESS' | 'COMPLETED'
type RegistrationStatus = 'PENDING' | 'CONFIRMED'
type Tournament = {
  id: string
  country_code: CountryCode
  title: string
  date: string
  time: string
  arenaId: string
  arenaName: string
  region: string
  category: Category
  maxTeams: number
  registeredTeamsCount: number
  entryFee: string
  prizes: string
  status: TournamentStatus
  userRegistration?: { isRegistered: boolean; partnerId?: string; partnerName: string; partnerStatus: RegistrationStatus; guestPhone?: string; note?: string }
  winners?: { firstPlace: string; secondPlace: string }
  bracketUrl?: string
}
type RegistrationForm = { partnerId: string; guestName: string; guestPhone: string; note: string; accepted: boolean }
type TournamentsViewProps = { publicView?: boolean; kioskView?: boolean }
const emptyForm: RegistrationForm = { partnerId: '', guestName: '', guestPhone: '', note: '', accepted: false }
const categoryLabels: Record<Category, string> = { BEGINNER: 'Začiatočníci', INTERMEDIATE: 'Mierne pokročilí', OPEN: 'OPEN', MIX: 'MIX', PRO: 'PRO' }
const fieldClass = 'rounded-lg border border-app-line/10 bg-app-canvas px-3 py-3 text-sm text-app-fg'

export function TournamentsView(props: TournamentsViewProps = {}) {
  const { country, isLoading } = useLeague()
  return isLoading ? null : <CountryTournamentsView key={country} {...props} />
}

function CountryTournamentsView({ publicView = false, kioskView = false }: TournamentsViewProps) {
  const { country } = useLeague()
  const { t } = useLanguage()
  const players = useSWR(['league-players', country], () => fetchLeaguePlayers(country))
  const [supabase] = useState(() => typeof window === 'undefined' ? null : createClient())
  const [authState, setAuthState] = useState<'checking' | 'verified' | 'locked'>('checking')
  const [tab, setTab] = useState<'upcoming' | 'mine' | 'completed'>('upcoming')
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [storageLoaded, setStorageLoaded] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const [selected, setSelected] = useState<Tournament | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Tournament | null>(null)
  const [form, setForm] = useState<RegistrationForm>(emptyForm)
  const storageKey = `riva-demo-tournaments-${country}`

  useEffect(() => {
    let active = true
    if (publicView) setAuthState('verified')
    else if (supabase) void supabase.auth.getUser().then(({ data, error }) => {
      if (active) setAuthState(!error && data.user?.email_confirmed_at ? 'verified' : 'locked')
    }).catch(() => { if (active) setAuthState('locked') })
    return () => { active = false }
  }, [supabase, publicView])

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
      if (Array.isArray(saved)) setTournaments(saved.filter((item): item is Tournament =>
        item !== null && typeof item === 'object' && item.country_code === country
        && typeof item.id === 'string' && typeof item.title === 'string'
        && typeof item.date === 'string' && typeof item.time === 'string'
        && Number.isFinite(Date.parse(`${item.date}T${item.time}`))
        && typeof item.maxTeams === 'number' && item.maxTeams > 0
        && typeof item.registeredTeamsCount === 'number'
        && ['OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED'].includes(item.status)
        && ['BEGINNER', 'INTERMEDIATE', 'OPEN', 'MIX', 'PRO'].includes(item.category)))
    } catch {
      setStorageError(true)
    }
    setStorageLoaded(true)
  }, [country, storageKey])

  useEffect(() => {
    if (!storageLoaded || storageError) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(tournaments))
    } catch {
      setStorageError(true)
    }
  }, [storageLoaded, storageError, storageKey, tournaments])

  const visible = useMemo(() => tournaments.filter((tournament) =>
    tab === 'completed' ? tournament.status === 'COMPLETED'
      : tab === 'mine' ? Boolean(tournament.userRegistration?.isRegistered)
        : tournament.status !== 'COMPLETED'), [tournaments, tab])

  function submitRegistration(event: React.FormEvent) {
    event.preventDefault()
    const partner = players.data?.find((player) => player.id === form.partnerId)
    const partnerName = partner?.name ?? form.guestName.trim()
    if (!selected || !form.accepted || !partnerName || publicView || kioskView) return
    setTournaments((current) => current.map((tournament) => tournament.id === selected.id ? {
      ...tournament,
      registeredTeamsCount: tournament.registeredTeamsCount + (tournament.userRegistration?.isRegistered ? 0 : 1),
      userRegistration: { isRegistered: true, partnerId: partner?.id, partnerName, partnerStatus: partner ? 'CONFIRMED' : 'PENDING', guestPhone: form.guestPhone, note: form.note },
    } : tournament))
    setSelected(null)
    setForm(emptyForm)
  }

  function cancelRegistration() {
    if (!cancelTarget || publicView || kioskView) return
    setTournaments((current) => current.map((tournament) => tournament.id === cancelTarget.id ? {
      ...tournament, registeredTeamsCount: Math.max(0, tournament.registeredTeamsCount - 1), userRegistration: undefined,
    } : tournament))
    setCancelTarget(null)
  }

  if (authState === 'checking') return <div className="grid min-h-[50vh] place-items-center"><p className="text-sm text-app-fg/50">{t('Overujem prístup…', 'Checking access…')}</p></div>
  if (authState === 'locked') return <div className="grid min-h-[50vh] place-items-center px-6 text-center"><div className="max-w-md">
    <h1 className="mt-4 text-3xl font-black uppercase">{t('Potvrď svoj e-mail', 'Confirm your email')}</h1>
    <p className="mt-4 text-sm leading-6 text-app-fg/50">{t('Turnaje sú dostupné po potvrdení e-mailovej adresy.', 'Tournaments are available after confirming your email address.')}</p>
    <Link href="/auth/login" className="mt-7 inline-flex rounded-lg bg-[#ccff00] px-5 py-3 text-xs font-bold text-[#10150d]">{t('Späť na prihlásenie', 'Back to login')}</Link>
  </div></div>

  return <div id="tournaments"><section className="mx-auto max-w-[1120px]">
    <header className="border-b border-app-line/10 pb-9">
      <p className="text-[10px] font-bold uppercase tracking-[.25em] text-app-league">RIVA / {country}</p>
      <h1 className="mt-3 text-4xl font-black uppercase tracking-[-.05em] sm:text-6xl">{t('Turnaje', 'Tournaments')}</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-app-fg/45">{t('Turnaje sú zatiaľ iba lokálna ukážka pre vybranú krajinu.', 'Tournaments are currently only a local demo for the selected country.')}</p>
      <p className="mt-2 text-xs font-bold text-app-league">{t('Ukážkové turnaje', 'Demo tournaments')}</p>
      {storageError ? <p role="status" className="mt-2 text-xs text-app-fg/55">{t('Lokálne údaje sa nepodarilo uložiť.', 'Local data could not be saved.')}</p> : null}
    </header>
    <div className={`mt-8 grid gap-2 rounded-xl border border-app-line/10 bg-app-panel p-1 ${publicView ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
      {(['upcoming', ...(!publicView ? ['mine' as const] : []), 'completed'] as const).map((value) =>
        <button key={value} onClick={() => setTab(value)} className={`rounded-lg px-4 py-3 text-xs font-bold ${tab === value ? 'bg-[#ccff00] text-[#10150d]' : 'text-app-fg/55'}`}>
          {value === 'upcoming' ? t('Nadchádzajúce turnaje', 'Upcoming tournaments') : value === 'mine' ? t('Moje turnaje', 'My tournaments') : t('Ukončené turnaje', 'Completed tournaments')}
        </button>)}
    </div>
    {visible.length === 0 ? <div className="mt-7 rounded-2xl border border-dashed border-app-line/15 bg-app-panel px-6 py-20 text-center">
      <Trophy className="mx-auto text-app-league" size={36} />
      <h2 className="mt-5 text-xl font-black">{tab === 'mine' ? t('Zatiaľ nie si prihlásený na žiadny turnaj', 'You have not registered for any tournaments yet')
        : tab === 'upcoming' ? t('Momentálne nie sú naplánované žiadne turnaje', 'No tournaments are currently scheduled')
          : t('Zatiaľ neboli odohraté žiadne turnaje', 'No tournaments have been played yet')}</h2>
      {tab === 'mine' ? <button onClick={() => setTab('upcoming')} className="mt-6 rounded-lg bg-[#ccff00] px-4 py-3 text-xs font-black text-[#10150d]">{t('Zobraziť nadchádzajúce turnaje', 'View upcoming tournaments')}</button> : null}
    </div> : <div className="mt-7 grid gap-5 lg:grid-cols-2">{visible.map((tournament) =>
      <TournamentCard key={tournament.id} tournament={tournament} readOnly={kioskView}
        onRegister={() => { if (publicView) window.location.assign('/auth/login'); else { setForm(emptyForm); setSelected(tournament) } }}
        onCancel={() => setCancelTarget(tournament)} />)}</div>}
  </section>
    {selected ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <form onSubmit={submitRegistration} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-app-line/10 bg-app-panel p-6">
        <div className="flex items-center justify-between"><h2 className="text-xl font-black">{selected.title}</h2><button type="button" onClick={() => setSelected(null)} aria-label={t('Zavrieť', 'Close')}><X size={20} /></button></div>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-2 text-xs font-bold text-app-fg/55">{t('Tvoj spoluhráč', 'Your partner')}<select value={form.partnerId} onChange={(event) => setForm((current) => ({ ...current, partnerId: event.target.value, guestName: '' }))} className={fieldClass}><option value="">{t('Vyber registrovaného hráča', 'Select a registered player')}</option>{(players.data ?? []).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
          <label className="grid gap-2 text-xs font-bold text-app-fg/55">{t('Hosťujúci spoluhráč', 'Guest partner')}<input required={!form.partnerId} value={form.guestName} onChange={(event) => setForm((current) => ({ ...current, guestName: event.target.value, partnerId: '' }))} className={fieldClass} /></label>
          <label className="grid gap-2 text-xs font-bold text-app-fg/55">{t('Telefón hosťa', 'Guest phone')}<input value={form.guestPhone} onChange={(event) => setForm((current) => ({ ...current, guestPhone: event.target.value }))} placeholder={country === 'NL' ? '+31 …' : '+421 …'} className={fieldClass} /></label>
          <label className="grid gap-2 text-xs font-bold text-app-fg/55">{t('Poznámka / preferencie', 'Note / preferences')}<textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} className={`min-h-20 ${fieldClass}`} /></label>
          <label className="flex items-start gap-3 text-xs leading-5 text-app-fg/60"><input required type="checkbox" checked={form.accepted} onChange={(event) => setForm((current) => ({ ...current, accepted: event.target.checked }))} className="mt-1 accent-[#ccff00]" />{t('Súhlasím s podmienkami turnaja a beriem na vedomie úhradu štartovného na mieste.', 'I agree to the tournament terms and understand that the entry fee is paid on site.')}</label>
        </div>
        <button className="mt-6 w-full rounded-lg bg-[#ccff00] py-3 text-xs font-black text-[#10150d]">{t('Potvrdiť prihlášku', 'Confirm registration')}</button>
      </form>
    </div> : null}
    {cancelTarget ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="w-full max-w-md rounded-2xl border border-app-line/10 bg-app-panel p-6">
      <h2 className="text-xl font-black">{t('Odhlásiť sa z turnaja?', 'Withdraw from the tournament?')}</h2>
      <p className="mt-3 text-sm leading-6 text-app-fg/50">{t('Tvoja dvojica bude odstránená z kapacity turnaja.', 'Your pair will be removed from the tournament capacity.')}</p>
      <div className="mt-6 flex justify-end gap-3"><button onClick={() => setCancelTarget(null)} className="rounded-lg border border-app-line/10 px-4 py-2.5 text-xs font-bold">{t('Zrušiť', 'Cancel')}</button><button onClick={cancelRegistration} className="rounded-lg bg-red-500/20 px-4 py-2.5 text-xs font-black text-app-red-200">{t('Odhlásiť sa', 'Withdraw')}</button></div>
    </div></div> : null}
  </div>
}

function TournamentCard({ tournament, onRegister, onCancel, readOnly }: { tournament: Tournament; onRegister: () => void; onCancel: () => void; readOnly: boolean }) {
  const { t, language } = useLanguage()
  const percent = Math.min(100, Math.round((tournament.registeredTeamsCount / tournament.maxTeams) * 100))
  const registered = tournament.userRegistration?.isRegistered
  const date = new Intl.DateTimeFormat(language === 'nl' ? 'nl-NL' : language === 'en' ? 'en-GB' : 'sk-SK', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${tournament.date}T${tournament.time}`))
  const statuses: Record<TournamentStatus, string> = { OPEN: t('PRIHLASOVANIE OTVORENÉ', 'REGISTRATION OPEN'), FULL: t('OBSADENÉ', 'FULL'), IN_PROGRESS: t('PREBIEHA', 'IN PROGRESS'), COMPLETED: t('UKONČENÝ', 'COMPLETED') }
  return <article className="rounded-2xl border border-app-line/[0.08] bg-app-panel p-5 sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><span className="rounded-full bg-[#ccff00]/10 px-2 py-1 text-[10px] font-black text-app-league">{t(categoryLabels[tournament.category])}</span><h2 className="mt-3 text-xl font-black">{tournament.title}</h2></div><span className="rounded-full bg-app-overlay/10 px-2 py-1 text-[10px] font-black text-app-fg/50">{statuses[tournament.status]}</span></div>
    <div className="mt-5 grid gap-3 text-xs text-app-fg/60 sm:grid-cols-2">
      <span className="inline-flex items-center gap-2"><CalendarDays size={15} className="text-app-league" />{date} • {tournament.time}</span>
      <span className="inline-flex items-center gap-2"><MapPin size={15} className="text-app-league" />{tournament.arenaName} · {tournament.region}</span>
      <span>{t('Štartovné', 'Entry fee')} <b className="text-app-fg">{tournament.entryFee}</b></span>
      <span>{t('Ceny', 'Prizes')} <b className="text-app-fg">{tournament.prizes}</b></span>
    </div>
    <div className="mt-5"><div className="flex justify-between text-xs font-bold"><span>{t('Obsadenosť', 'Capacity')}</span><span>{tournament.registeredTeamsCount} / {tournament.maxTeams} {t('dvojíc', 'pairs')}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-app-overlay/10"><div className="h-full rounded-full bg-[#ccff00] transition-all" style={{ width: `${percent}%` }} /></div></div>
    {registered && !readOnly ? <div className="mt-5 flex items-center justify-between rounded-xl border border-[#ccff00]/20 bg-[#ccff00]/[0.06] p-3">
      <span className="inline-flex items-center gap-2 text-xs font-bold text-app-league"><Users size={15} />{t('Tvoj spoluhráč', 'Your partner')}: {tournament.userRegistration?.partnerName} ({tournament.userRegistration?.partnerStatus === 'CONFIRMED' ? t('Schválené', 'Confirmed') : t('Čaká sa', 'Pending')})</span><button onClick={onCancel} className="text-[11px] font-bold text-app-red-200">{t('Odhlásiť sa', 'Withdraw')}</button>
    </div> : !registered && !readOnly ? <button disabled={tournament.status !== 'OPEN'} onClick={onRegister} className="mt-5 w-full rounded-lg bg-[#ccff00] py-3 text-xs font-black text-[#10150d] disabled:cursor-not-allowed disabled:opacity-40">{t('Prihlásiť sa na turnaj', 'Register for tournament')} <ChevronRight className="ml-1 inline" size={14} /></button> : null}
  </article>
}
