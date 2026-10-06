'use client'

import { FormEvent, useEffect, useState } from 'react'
import useSWR from 'swr'
import { MessageSquare, Plus, Users } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { PlayerSearchView } from '@/components/find-players-view'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import { fetchPlayerProfile } from '@/lib/profiles'
import type { LeaguePlayer } from '@/lib/players'

const REGIONS = ['Bratislavský kraj', 'Trnavský kraj', 'Trenčiansky kraj', 'Nitriansky kraj', 'Žilinský kraj', 'Banskobystrický kraj', 'Prešovský kraj', 'Košický kraj']
const LEVELS = ['Začiatočník', 'Mierne pokročilý', 'Pokročilý', 'Expert']
const REQUEST_TYPES = [
  { value: 'potrebujeme_hraca', label: 'Potrebujeme jedného hráča', existingPlayers: 3 },
  { value: 'potrebujeme_dvoch_hracov', label: 'Potrebujeme dvoch hráčov', existingPlayers: 2 },
  { value: 'potrebujeme_troch_hracov', label: 'Potrebujeme troch hráčov', existingPlayers: 1 },
]
const fieldClass = 'w-full rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]'

function normalizeFilterValue(value: string) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').replace(/\s*kraj$/i, '').toLowerCase()
}

function formatRequestTime(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 5) : parsed.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })
}

function formatRequestDate(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('sk-SK')
}

type PlayerRequest = {
  id: number
  user_id: number
  request_type: string
  region: string
  level: string | null
  match_date: string | null
  match_time: string | null
  participants_names: string | null
  note: string | null
  created_at: string
  proffiles: { full_name: string; email: string } | null
}

type JoinedPlayerRequest = Omit<PlayerRequest, 'proffiles'> & {
  proffiles: PlayerRequest['proffiles'] | NonNullable<PlayerRequest['proffiles']>[]
}

export function PlayerMarketplaceView({ currentPlayerId, currentPlayerAvatarUrl, defaultRegion, onMessage }: {
  currentPlayerId?: string
  currentPlayerAvatarUrl?: string | null
  defaultRegion?: string
  onMessage: (player: LeaguePlayer) => void
}) {
  const { t } = useLanguage()
  const [activeTab, setActiveTab] = useState<'players' | 'listings'>('players')
  const [listingRegion, setListingRegion] = useState('')
  const [listingLevel, setListingLevel] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [requestType, setRequestType] = useState(REQUEST_TYPES[0].value)
  const [region, setRegion] = useState(defaultRegion ?? '')
  const [matchDate, setMatchDate] = useState('')
  const [matchTime, setMatchTime] = useState('')
  const [currentProfileLevel, setCurrentProfileLevel] = useState('')
  const [participants, setParticipants] = useState(['', '', ''])
  const [note, setNote] = useState('')
  const [selectedListing, setSelectedListing] = useState<PlayerRequest | null>(null)
  const [messageContent, setMessageContent] = useState('')
  const [actionError, setActionError] = useState('')
  const [currentProfileId, setCurrentProfileId] = useState<number | null>(null)
  const participantFieldCount = REQUEST_TYPES.find((type) => type.value === requestType)?.existingPlayers ?? 1

  useEffect(() => {
    let isActive = true
    void createClient().auth.getUser().then(async ({ data, error }) => {
      if (error) throw error
      const profile = data.user?.email ? await fetchPlayerProfile(data.user.email) : null
      if (isActive) {
        setCurrentProfileId(profile?.id ?? null)
        setCurrentProfileLevel(profile?.level ?? '')
      }
    }).catch((error: unknown) => {
      if (isActive) setActionError(getErrorMessage(error, t('Profil sa nepodarilo načítať.')))
    })
    return () => { isActive = false }
  }, [t])

  function changeRequestType(value: string) {
    const nextCount = REQUEST_TYPES.find((type) => type.value === value)?.existingPlayers ?? 1
    setRequestType(value)
    setParticipants((current) => Array.from({ length: nextCount }, (_, index) => current[index] ?? ''))
  }

  const listings = useSWR(['player-requests', listingRegion, listingLevel], async () => {
    let query = createClient().from('player_requests').select('id, user_id, request_type, region, level, match_date, match_time, participants_names, note, created_at, proffiles(full_name, email)').eq('is_active', true)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw error
    const regionValue = normalizeFilterValue(listingRegion)
    const levelValue = normalizeFilterValue(listingLevel)
    const showAllRegions = !regionValue || ['vsetky kraje', 'cele slovensko'].includes(regionValue)
    const showAllLevels = !levelValue || ['vsetky urovne', 'vsetky urovne hraca'].includes(levelValue)
    const normalizedData = ((data ?? []) as unknown as JoinedPlayerRequest[]).map((listing): PlayerRequest => ({
      ...listing,
      proffiles: Array.isArray(listing.proffiles) ? listing.proffiles[0] ?? null : listing.proffiles,
    }))
    return normalizedData.filter((listing) =>
      (showAllRegions || normalizeFilterValue(listing.region) === regionValue) &&
      (showAllLevels || normalizeFilterValue(listing.level ?? '') === levelValue))
  })

  useEffect(() => {
    const client = createClient()
    const channel = client
      .channel('player-requests-live-refresh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_requests' }, () => {
        void listings.mutate(undefined, { revalidate: true })
      })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [listings.mutate])

  async function handleCreateListing(event: FormEvent) {
    event.preventDefault()
    setActionError('')
    if (!currentProfileId) {
      setActionError(t('Profil prihláseného používateľa sa nenašiel.'))
      return
    }
    if (matchTime && !matchDate) {
      setActionError(t('Pri zadaní času vyber aj dátum.'))
      return
    }

    const participantsArray = participants.slice(0, participantFieldCount).map((name) => name.trim())
    if (participantsArray.some((name) => !name)) {
      setActionError(`Vyplň mená všetkých ${participantFieldCount} zúčastnených hráčov.`)
      return
    }
    const matchDateTime = matchDate
      ? new Date(`${matchDate}T${matchTime || '00:00'}:00`).toISOString()
      : null
    const { error } = await createClient().from('player_requests').insert({
      user_id: currentProfileId,
      request_type: requestType,
      region,
      level: currentProfileLevel || null,
      match_date: matchDateTime,
      match_time: matchDate && matchTime ? matchDateTime : null,
      participants_names: participantsArray.join(', '),
      ...(note.trim() ? { note: note.trim() } : {}),
      is_active: true,
    })

    if (error) {
      const message = getErrorMessage(error, t('Inzerát sa nepodarilo vytvoriť.'))
      console.error('Vytvorenie inzerátu zlyhalo:', message)
      setActionError(message)
      return
    }

    setShowCreateModal(false)
    setNote('')
    setMatchDate('')
    setMatchTime('')
    setParticipants(Array.from({ length: participantFieldCount }, () => ''))
    await listings.mutate(undefined, { revalidate: true })
  }

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault()
    if (!selectedListing || !currentProfileId) return
    setActionError('')

    const { error } = await createClient().from('messages').insert({
      sender_id: currentProfileId,
      receiver_id: selectedListing.user_id,
      content: messageContent.trim(),
      request_id: selectedListing.id,
      is_read: false,
    })

    if (error) {
      const message = getErrorMessage(error, t('Správu sa nepodarilo odoslať.'))
      console.error('Odoslanie správy zlyhalo:', message)
      setActionError(message)
      return
    }

    setSelectedListing(null)
    setMessageContent('')
    window.alert(t('Správa bola úspešne odoslaná.'))
  }

  return (
    <div className="mx-auto max-w-[1120px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">SPL / HRÁČI</p>
          <h1 className="mt-2 text-3xl font-black">Nájsť hráčov</h1>
          <p className="mt-2 text-sm text-white/45">Vyhľadaj hráčov ligy SPL alebo pozri aktívne inzeráty.</p>
        </div>
        <nav className="flex gap-2" aria-label="Matchmaking">
          <button type="button" onClick={() => setActiveTab('players')} aria-pressed={activeTab === 'players'} className={`rounded-lg px-4 py-2.5 text-sm font-bold ${activeTab === 'players' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-white/10 text-white/65'}`}>Hráči</button>
          <button type="button" onClick={() => setActiveTab('listings')} aria-pressed={activeTab === 'listings'} className={`rounded-lg px-4 py-2.5 text-sm font-bold ${activeTab === 'listings' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-white/10 text-white/65'}`}>Inzeráty & výzvy</button>
        </nav>
      </div>

      {activeTab === 'players' ? (
        <PlayerSearchView currentPlayerId={currentProfileId === null ? undefined : String(currentProfileId)} currentPlayerAvatarUrl={currentPlayerAvatarUrl} defaultRegion={defaultRegion} showCurrentPlayer onMessage={onMessage} />
      ) : (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-bold">Burza hráčov</h2>
            <button type="button" onClick={() => { setActionError(''); setShowCreateModal(true) }} className="inline-flex items-center gap-2 rounded-lg bg-[#ccff00] px-4 py-2.5 text-sm font-black text-[#10150d]"><Plus size={16} /> Vytvoriť inzerát</button>
          </div>
          <div className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Filtrovať podľa kraja<select value={listingRegion} onChange={(event) => setListingRegion(event.target.value)} className={fieldClass}><option value="">Všetky kraje</option>{REGIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Filtrovať podľa úrovne<select value={listingLevel} onChange={(event) => setListingLevel(event.target.value)} className={fieldClass}><option value="">Všetky úrovne</option>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          {listings.error ? <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{getErrorMessage(listings.error, t('Inzeráty sa nepodarilo načítať.'))}</p> : null}
          {listings.isLoading ? <p role="status" className="py-12 text-center text-sm text-white/50">Načítavam inzeráty…</p> : (
            <ul className="mt-5 grid gap-4 md:grid-cols-2">
              {(listings.data ?? []).map((item) => <li key={item.id} className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#111722] p-5">
                <div>
                  <span className="rounded-full bg-[#ccff00]/10 px-2.5 py-1 text-xs font-semibold text-[#ccff00]">{REQUEST_TYPES.find((type) => type.value === item.request_type)?.label ?? item.request_type}</span>
                  <p className="mt-3 text-sm">Kraj: {item.region}</p>
                  <p className="mt-1 text-sm text-white/55">Úroveň: {item.level || 'Neuvedená'}</p>
                  {item.match_date || item.match_time ? <p className="mt-1 text-sm text-white/55">Termín: {item.match_date ? formatRequestDate(item.match_date) : ''}{item.match_date && item.match_time ? ' · ' : ''}{item.match_time ? formatRequestTime(item.match_time) : ''}</p> : null}
                  {item.participants_names?.trim() ? <p className="mt-2 text-sm text-white/55">Zapojení hráči: {item.participants_names}</p> : null}
                  {item.note ? <p className="mt-3 rounded-lg bg-white/[0.04] p-3 text-sm italic text-white/70">{item.note}</p> : null}
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-3">
                  <span className="text-xs text-white/45">Autor: {item.proffiles?.full_name || 'Neznámy'}</span>
                  <button type="button" onClick={() => { setActionError(''); setSelectedListing(item) }} className="inline-flex items-center gap-1.5 text-sm font-bold text-[#ccff00]"><MessageSquare size={14} /> Reagovať správou</button>
                </div>
              </li>)}
              {!listings.data?.length && !listings.error && !listings.isLoading ? <li className="rounded-xl border border-white/[0.08] bg-[#111722] p-5 text-sm text-white/50">Zatiaľ tu nie sú žiadne aktívne inzeráty.</li> : null}
            </ul>
          )}
        </section>
      )}

      {showCreateModal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111722] p-6">
          <h2 className="text-lg font-bold">Nový inzerát / výzva</h2>
          <form onSubmit={handleCreateListing} className="mt-4 space-y-4">
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Typ inzerátu<select value={requestType} onChange={(event) => changeRequestType(event.target.value)} className={fieldClass}>{REQUEST_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Kraj<select required value={region} onChange={(event) => setRegion(event.target.value)} className={fieldClass}><option value="">Vyber kraj</option>{REGIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Dátum (voliteľné)<input type="date" value={matchDate} onChange={(event) => setMatchDate(event.target.value)} className={fieldClass} /></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Čas (voliteľné)<input type="time" value={matchTime} onChange={(event) => setMatchTime(event.target.value)} className={fieldClass} /></label>
            <p className="text-xs text-white/50">Úroveň vyzývateľa: <span className="font-semibold text-white/75">{currentProfileLevel || 'Neuvedená v profile'}</span></p>
            {participants.slice(0, participantFieldCount).map((participant, index) => <label key={index} className="grid gap-1.5 text-xs font-bold text-white/55">Hráč {index + 1}<input required value={participant} onChange={(event) => setParticipants((current) => current.map((name, slot) => slot === index ? event.target.value : name))} placeholder={`Meno hráča ${index + 1}`} className={fieldClass} /></label>)}
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Poznámka<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} className={fieldClass} /></label>
            {actionError ? <p role="alert" className="text-sm text-red-300">{actionError}</p> : null}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreateModal(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70">Zrušiť</button><button type="submit" className="rounded-lg bg-[#ccff00] px-4 py-2 text-sm font-bold text-[#10150d]">Vytvoriť</button></div>
          </form>
        </div>
      </div> : null}

      {selectedListing ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111722] p-6">
          <h2 className="text-lg font-bold">Reagovať na inzerát</h2>
          <p className="mt-2 text-sm text-white/55">Posielaš správu používateľovi: <strong>{selectedListing.proffiles?.full_name || 'Neznámy'}</strong></p>
          <form onSubmit={handleSendMessage} className="mt-4 space-y-4">
            <textarea required rows={4} value={messageContent} onChange={(event) => setMessageContent(event.target.value)} placeholder="Napíš svoju správu…" className={fieldClass} />
            {actionError ? <p role="alert" className="text-sm text-red-300">{actionError}</p> : null}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setSelectedListing(null)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70">Zrušiť</button><button type="submit" className="rounded-lg bg-[#ccff00] px-4 py-2 text-sm font-bold text-[#10150d]">Odoslať</button></div>
          </form>
        </div>
      </div> : null}
    </div>
  )
}
