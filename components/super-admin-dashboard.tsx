'use client'

import { AppBackground } from '@/components/app-background'
import { DeviceTelemetryStatus } from '@/components/device-telemetry-status'
import { SuperAdminMatchAnalytics } from '@/components/super-admin-match-analytics'
import { ClickerRentals } from '@/components/clicker-rentals'
import { ArenaSettlements } from '@/components/arena-settlements'
import { DeviceReloadControl } from '@/components/device-reload-control'
import { SuperAdminElo } from '@/components/super-admin-elo'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  BellRing,
  Building2,
  ClipboardList,
  Plus,
  Radio,
  Shield,
  Tablet,
  UserPlus,
  UserRoundX,
} from 'lucide-react'

type Arena = {
  id: string
  name: string
  city: string
  address: string
  countryCode: string
  isActive: boolean
  courtsCount: number
}

type Kiosk = {
  id: string
  arenaId: string
  courtId: string | null
  deviceRole: string
  name: string
  createdAt: string
  revokedAt: string | null
}

type Manager = {
  arenaId: string
  userId: string
  email: string
  createdAt: string
}

type AuditEntry = {
  id: number
  actorId: string
  action: string
  targetType: string
  targetId: string | null
  details: Record<string, unknown>
  createdAt: string
}

type Props = {
  arenas: Arena[]
  devices: Kiosk[]
  managers: Manager[]
  audit: AuditEntry[]
}

type Section = 'overview' | 'arenas' | 'devices' | 'analytics' | 'rentals' | 'settlements' | 'elo' | 'system' | 'audit'

const sections: { id: Section; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Prehľad', icon: Activity },
  { id: 'arenas', label: 'Arény a správcovia', icon: Building2 },
  { id: 'devices', label: 'Zariadenia', icon: Tablet },
  { id: 'analytics', label: 'Štatistiky zápasov', icon: Activity },
  { id: 'rentals', label: 'Prenájmy klikrov', icon: ClipboardList },
  { id: 'settlements', label: 'Vyúčtovanie a platby', icon: ClipboardList },
  { id: 'elo', label: 'Opravy ELO', icon: Activity },
  { id: 'system', label: 'Oznámenia', icon: BellRing },
  { id: 'audit', label: 'Audit', icon: ClipboardList },
]

export function SuperAdminDashboard({ arenas, devices, managers, audit }: Props) {
  const router = useRouter()
  const [section, setSection] = useState<Section>('overview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function runAction(action: () => Promise<void>, successMessage: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(successMessage)
      router.refresh()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Požiadavku sa nepodarilo vykonať.'
      console.error('Super Admin action failed:', reason)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="photo-layout relative isolate min-h-[100svh] text-app-fg">
      <AppBackground />
      <div className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-7 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-app-league">RIVA / GLOBÁLNA SPRÁVA</p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">Super Admin</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-app-fg/55">
              Centrálna správa arén, prístupov, autorizovaných zariadení a systémových oznámení.
            </p>
          </div>
          <Link href="/profile" className="rounded-lg border border-app-line/15 px-4 py-2 text-sm font-bold text-app-fg/70 hover:border-app-league/50">
            Späť do aplikácie
          </Link>
          <Link href="/arena-admin" className="rounded-lg border border-app-line/15 px-4 py-2 text-sm font-bold text-app-fg/70 hover:border-app-league/50">
            Kurty a priradenie tabletu
          </Link>
        </header>

        <nav className="mt-7 flex gap-2 overflow-x-auto pb-2" aria-label="Sekcie Super Admin">
          {sections.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setSection(id)} aria-current={section === id ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold ${section === id ? 'border-[#ccff00]/50 bg-[#ccff00] text-[#10150d]' : 'border-app-line/10 bg-app-panel text-app-fg/65 hover:border-app-line/25'}`}>
              <Icon size={16} aria-hidden="true" />{label}
            </button>
          ))}
        </nav>

        {error ? <p role="alert" className="mt-4 rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
        {notice ? <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</p> : null}

        {section === 'overview' ? <Overview arenas={arenas} devices={devices} managers={managers} /> : null}
        {section === 'arenas' ? <ArenaManagement arenas={arenas} managers={managers} busy={busy} runAction={runAction} /> : null}
        {section === 'devices' ? <DeviceManagement devices={devices} arenas={arenas} busy={busy} runAction={runAction} /> : null}
        {section === 'analytics' ? <SuperAdminMatchAnalytics /> : null}
        {section === 'rentals' ? <ClickerRentals superAdmin /> : null}
        {section === 'settlements' ? <ArenaSettlements superAdmin /> : null}
        {section === 'elo' ? <SuperAdminElo /> : null}
        {section === 'system' ? <SystemAnnouncements busy={busy} runAction={runAction} /> : null}
        {section === 'audit' ? <AuditHistory audit={audit} /> : null}

      </div>
    </main>
  )
}

function Overview({ arenas, devices, managers }: Pick<Props, 'arenas' | 'devices' | 'managers'>) {
  const activeDevices = devices.filter((device) => !device.revokedAt).length
  const stats = [
    { title: 'Arény', value: arenas.length, detail: `${arenas.filter((arena) => arena.isActive).length} aktívnych`, icon: Building2 },
    { title: 'Správcovia', value: managers.length, detail: 'Priradenia k arénam', icon: Shield },
    { title: 'Kiosk zariadenia', value: activeDevices, detail: `${devices.length - activeDevices} odvolaných`, icon: Tablet },
  ]
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-3">
      {stats.map(({ title, value, detail, icon: Icon }) => (
        <section key={title} className="rounded-2xl border border-app-line/10 bg-app-panel p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-app-fg/60">{title}</p>
            <Icon size={18} className="text-app-league" aria-hidden="true" />
          </div>
          <p className="mt-4 text-4xl font-black">{value}</p>
          <p className="mt-1 text-xs text-app-fg/45">{detail}</p>
        </section>
      ))}
      <section className="rounded-2xl border border-app-line/10 bg-app-panel p-5 md:col-span-3">
        <h2 className="font-black">Stav siete</h2>
        {arenas.length === 0 ? <p className="mt-3 text-sm text-app-fg/50">Zatiaľ nie sú registrované žiadne arény.</p> : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {arenas.map((arena) => (
              <li key={arena.id} className="flex items-center justify-between gap-3 rounded-lg bg-app-ink/60 px-3 py-2.5 text-sm">
                <span className="min-w-0 truncate font-bold">{arena.name}<span className="ml-2 font-normal text-app-fg/45">{arena.city}</span></span>
                <span className={`shrink-0 text-xs ${arena.isActive ? 'text-emerald-300' : 'text-app-fg/40'}`}>{arena.isActive ? 'Aktívna' : 'Pozastavená'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ArenaManagement({ arenas, managers, busy, runAction }: {
  arenas: Arena[]
  managers: Manager[]
  busy: boolean
  runAction: (action: () => Promise<void>, successMessage: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [countryCode, setCountryCode] = useState('SK')
  const [region, setRegion] = useState('')
  const [courtCount, setCourtCount] = useState('1')
  const [managerEmails, setManagerEmails] = useState<Record<string, string>>({})

  async function createArena(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const supabase = createClient()
    await runAction(async () => {
      const { error } = await supabase.rpc('super_admin_create_arena', {
        p_name: name.trim(), p_city: city.trim(), p_address: address.trim(),
        p_country_code: countryCode, p_region: region.trim(), p_court_count: Number(courtCount),
      })
      if (error) throw error
      setName('')
      setCity('')
      setAddress('')
      setRegion('')
      setCourtCount('1')
    }, 'Aréna bola vytvorená.')
  }

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Panel title="Pridať arénu" eyebrow="NOVÝ KLUB" icon={<Plus size={17} />}>
        <form onSubmit={createArena} className="space-y-3">
          <Field label="Názov"><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
          <Field label="Mesto"><input required maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} className={inputClass} /></Field>
          <Field label="Adresa"><input required maxLength={240} value={address} onChange={(event) => setAddress(event.target.value)} className={inputClass} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kraj / región"><input required maxLength={100} value={region} onChange={(event) => setRegion(event.target.value)} className={inputClass} /></Field>
            <Field label="Krajina">
              <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)} className={inputClass}>
                <option value="SK">Slovensko</option><option value="NL">Holandsko</option>
              </select>
            </Field>
          </div>
          <Field label="Počet kurtov"><input required type="number" min="1" max="100" value={courtCount} onChange={(event) => setCourtCount(event.target.value)} className={inputClass} /></Field>
          <button type="submit" disabled={busy} className={primaryButton}><Plus size={16} />Vytvoriť arénu</button>
        </form>
      </Panel>

      <Panel title="Všetky arény" eyebrow={`${arenas.length} V EVIDENCII`} icon={<Building2 size={17} />}>
        <ul className="divide-y divide-app-line/10">
          {arenas.map((arena) => (
            <li key={arena.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black">{arena.name}</p>
                  <p className="mt-1 text-xs text-app-fg/45">{[arena.address, arena.city, arena.countryCode].filter(Boolean).join(' · ')} · {arena.courtsCount} kurtov</p>
                </div>
                <button type="button" disabled={busy} onClick={() => void runAction(async () => {
                  const { error } = await createClient().rpc('super_admin_set_arena_active', { p_arena_id: Number(arena.id), p_is_active: !arena.isActive })
                  if (error) throw error
                }, arena.isActive ? 'Aréna bola pozastavená.' : 'Aréna bola aktivovaná.')}
                  className="rounded-lg border border-app-line/15 px-3 py-2 text-xs font-bold hover:border-app-league/40 disabled:opacity-50">
                  {arena.isActive ? 'Pozastaviť' : 'Aktivovať'}
                </button>
              </div>
              <ul className="mt-3 space-y-2">
                {managers.filter((manager) => manager.arenaId === arena.id).map((manager) => (
                  <li key={manager.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-app-ink/55 px-3 py-2 text-xs">
                    <span>{manager.email}</span>
                    <button type="button" disabled={busy} aria-label={`Odobrať správcu ${manager.email}`} onClick={() => {
                      if (!window.confirm(`Naozaj odobrať ${manager.email} z arény ${arena.name}?`)) return
                      void runAction(async () => {
                        const { error } = await createClient().rpc('super_admin_remove_arena_manager', { p_arena_id: Number(arena.id), p_user_id: manager.userId })
                        if (error) throw error
                      }, 'Prístup správcu bol odobratý.')
                    }} className="text-app-fg/45 hover:text-red-300"><UserRoundX size={15} /></button>
                  </li>
                ))}
              </ul>
              <form onSubmit={(event) => {
                event.preventDefault()
                const email = managerEmails[arena.id]?.trim()
                if (!email) return
                void runAction(async () => {
                  const { error } = await createClient().rpc('super_admin_assign_arena_manager', { p_arena_id: Number(arena.id), p_email: email })
                  if (error) throw error
                  setManagerEmails((current) => ({ ...current, [arena.id]: '' }))
                }, 'Správca bol priradený. Účet musí už existovať v Supabase Auth.')
              }} className="mt-3 flex gap-2">
                <input type="email" required maxLength={254} aria-label={`E-mail nového správcu pre ${arena.name}`} placeholder="E-mail existujúceho účtu"
                  value={managerEmails[arena.id] ?? ''} onChange={(event) => setManagerEmails((current) => ({ ...current, [arena.id]: event.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-app-line/15 bg-app-ink px-3 py-2 text-xs outline-none focus:border-app-league/50" />
                <button type="submit" disabled={busy} title="Priradiť správcu" className="rounded-lg border border-app-line/15 px-3 text-app-league hover:border-app-league/40 disabled:opacity-50"><UserPlus size={15} /></button>
              </form>
            </li>
          ))}
        </ul>
        {arenas.length === 0 ? <p className="text-sm text-app-fg/50">Zatiaľ nie sú pridané žiadne arény.</p> : null}
      </Panel>
    </div>
  )
}

function DeviceManagement({ devices, arenas, busy, runAction }: {
  devices: Kiosk[]
  arenas: Arena[]
  busy: boolean
  runAction: (action: () => Promise<void>, successMessage: string) => Promise<void>
}) {
  const arenaNames = new Map(arenas.map((arena) => [arena.id, arena.name]))
  return (
    <Panel title="Autorizované kiosky" eyebrow={`${devices.length} ZARIADENÍ`} icon={<Tablet size={17} />}>
      <div className="mb-4 flex items-start gap-2 rounded-lg bg-app-ink/60 p-3 text-xs leading-5 text-app-fg/55">
        <Radio size={15} className="mt-0.5 shrink-0 text-app-league" />
        Stav sa obnovuje každých 15 sekúnd. Po 90 sekundách bez signálu sa zobrazí „Bez spojenia“. Aktívna aréna neznamená pripojené zariadenie.
      </div>
      {devices.length === 0 ? <p className="text-sm text-app-fg/50">Zatiaľ nie sú autorizované žiadne kiosk zariadenia.</p> : (
        <ul className="divide-y divide-app-line/10">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
              <div>
                <p className="font-bold">{device.name} · {device.deviceRole === 'scoreboard' ? 'TV' : 'Tablet'}</p>
                <DeviceTelemetryStatus deviceId={device.id} revoked={Boolean(device.revokedAt)} />
                <p className="mt-1 text-xs text-app-fg/45">{arenaNames.get(device.arenaId) ?? `Aréna ${device.arenaId}`} · {device.courtId ? `Kurt ID ${device.courtId}` : 'Bez priradeného kurtu'} · autorizované {formatDate(device.createdAt)}</p>
                {device.courtId ? <Link href={`/scoreboard/${encodeURIComponent(device.courtId)}`} target="_blank" className="mt-1 inline-block text-xs text-app-league">Monitor skóre kurtu</Link> : null}
              </div>
              {device.revokedAt ? <span className="text-xs text-app-fg/40">Odvolané {formatDate(device.revokedAt)}</span> : (<div className="space-y-3">
                {device.courtId ? <DeviceReloadControl deviceId={device.id} /> : null}
                <button type="button" disabled={busy} onClick={() => {
                  if (!window.confirm(`Odvolať autorizáciu zariadenia ${device.name}?`)) return
                  void runAction(async () => {
                    const { error } = await createClient().rpc('super_admin_revoke_kiosk_device', { p_device_id: device.id })
                    if (error) throw error
                  }, 'Autorizácia kiosk zariadenia bola odvolaná.')
                }} className="rounded-lg border border-red-300/20 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-400/10 disabled:opacity-50">Odvolať</button></div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function SystemAnnouncements({ busy, runAction }: {
  busy: boolean
  runAction: (action: () => Promise<void>, successMessage: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Oznámenie hráčom" eyebrow="GLOBÁLNA SPRÁVA" icon={<BellRing size={17} />}>
        <p className="mb-4 text-sm leading-6 text-app-fg/55">Oznámenie sa uloží medzi globálne notifikácie. Push sa odošle len vtedy, ak je nakonfigurovaný existujúci webhook a hráči majú povolené push notifikácie.</p>
        <form onSubmit={(event) => {
          event.preventDefault()
          void runAction(async () => {
            const { error } = await createClient().rpc('super_admin_send_announcement', { p_title: title.trim(), p_body: body.trim() })
            if (error) throw error
            setTitle('')
            setBody('')
          }, 'Oznámenie bolo odoslané.')
        }} className="space-y-3">
          <Field label="Nadpis"><input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} /></Field>
          <Field label="Správa"><textarea required maxLength={1000} rows={5} value={body} onChange={(event) => setBody(event.target.value)} className={`${inputClass} resize-y`} /></Field>
          <button type="submit" disabled={busy} className={primaryButton}><BellRing size={16} />Odoslať všetkým</button>
        </form>
      </Panel>
      <Panel title="Globálne nastavenia" eyebrow="ĎALŠIA FÁZA" icon={<Shield size={17} />}>
        <p className="text-sm leading-6 text-app-fg/55">Minimálna verzia aplikácie, feature flags, správa licencií, fakturácia a audit zmien skóre potrebujú samostatnú databázovú schému a integráciu do príslušných funkcií aplikácie. Panel ich zatiaľ nezobrazuje ako aktívne prepínače.</p>
      </Panel>
    </div>
  )
}

function AuditHistory({ audit }: { audit: AuditEntry[] }) {
  return (
    <Panel title="História zásahov Super Admina" eyebrow={`${audit.length} POSLEDNÝCH ZÁZNAMOV`} icon={<ClipboardList size={17} />}>
      {audit.length === 0 ? <p className="text-sm text-app-fg/50">Zatiaľ neboli zaznamenané žiadne akcie.</p> : (
        <ul className="divide-y divide-app-line/10">
          {audit.map((entry) => (
            <li key={entry.id} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{auditLabel(entry.action)} <span className="font-normal text-app-fg/45">· {entry.targetType} {entry.targetId ?? ''}</span></p>
                <time dateTime={entry.createdAt} className="text-xs text-app-fg/40">{formatDate(entry.createdAt)}</time>
              </div>
              <p className="mt-1 break-all text-[11px] text-app-fg/35">Používateľ: {entry.actorId}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Panel({ title, eyebrow, icon, children }: { title: string; eyebrow: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-app-line/10 bg-app-panel p-5 sm:p-6">
      <header className="mb-5 flex items-center gap-3">
        <span className="text-app-league">{icon}</span>
        <div><p className="text-[10px] font-bold tracking-[0.18em] text-app-fg/40">{eyebrow}</p><h2 className="mt-1 text-lg font-black">{title}</h2></div>
      </header>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-bold text-app-fg/55">{label}</span>{children}</label>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('sk-SK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    'arena.created': 'Vytvorená aréna',
    'payment.recorded': 'Zaevidovaná prijatá platba',
    'payment.voided': 'Stornovaná platba',
    'device.reload_requested': 'Vyžiadané obnovenie aplikácie',
    'elo.adjusted': 'Manuálna oprava ELO',
    'arena.updated': 'Upravená aréna',
    'arena.deleted': 'Odstránená aréna',
    'arena_manager.assigned': 'Priradený správca',
    'arena_manager.removed': 'Odstránený správca',
    'kiosk_device.revoked': 'Odvolané kiosk zariadenie',
    'announcement.sent': 'Odoslané oznámenie',
  }
  return labels[action] ?? action
}

const inputClass = 'min-h-10 w-full rounded-lg border border-app-line/15 bg-app-ink px-3 text-sm outline-none focus:border-app-league/60'
const primaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#ccff00] px-4 text-sm font-black text-[#10150d] disabled:opacity-50'
