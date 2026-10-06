'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DELETED_PROFILE_EMAIL_DOMAIN } from '@/lib/profiles'

const REGIONS = ['Bratislavský kraj', 'Trnavský kraj', 'Trenčiansky kraj', 'Nitriansky kraj', 'Žilinský kraj', 'Banskobystrický kraj', 'Prešovský kraj', 'Košický kraj']
const LEVELS = ['Začiatočník', 'Mierne pokročilý', 'Pokročilý', 'Expert']
const REQUEST_TYPES = [
  { value: 'potrebujeme_hraca', label: 'Potrebujeme jedného hráča', existingPlayers: 3 },
  { value: 'potrebujeme_dvoch_hracov', label: 'Potrebujeme dvoch hráčov', existingPlayers: 2 },
  { value: 'potrebujeme_troch_hracov', label: 'Potrebujeme troch hráčov', existingPlayers: 1 },
]

function normalizeFilterValue(value: string) {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').replace(/\s*kraj$/i, '').toLowerCase()
}

type Player = {
  id: number
  full_name: string | null
  email: string | null
  region: string | null
  level: string | null
  elo_rating: number | null
  avatar_url: string | null
}

type Listing = {
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
  proffiles?: { full_name: string; email: string } | null
}

export default function FindPlayerPage() {
  const supabase = createClient()
  const [activeTab, setActiveTab] = useState<'players' | 'listings'>('players')
  const [players, setPlayers] = useState<Player[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterRegion, setFilterRegion] = useState('Všetky kraje')
  const [filterLevel, setFilterLevel] = useState('Všetky úrovne')
  const [filterEloMin, setFilterEloMin] = useState(0)
  const [filterEloMax, setFilterEloMax] = useState(10000)
  const [listingRegion, setListingRegion] = useState('')
  const [listingLevel, setListingLevel] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [requestType, setRequestType] = useState(REQUEST_TYPES[0].value)
  const [region, setRegion] = useState('')
  const [matchDate, setMatchDate] = useState('')
  const [matchTime, setMatchTime] = useState('')
  const [currentUserLevel, setCurrentUserLevel] = useState('')
  const [participants, setParticipants] = useState(['', '', ''])
  const [note, setNote] = useState('')
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null)
  const [messageContent, setMessageContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const participantFieldCount = REQUEST_TYPES.find((type) => type.value === requestType)?.existingPlayers ?? 1

  const fetchUserAndData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw authError

      if (user?.email) {
        const { data: profile, error: profileError } = await supabase
          .from('proffiles')
          .select('id, level')
          .eq('email', user.email)
          .maybeSingle()
        if (profileError) throw profileError
        setCurrentUserId(profile?.id ?? null)
        setCurrentUserLevel(profile?.level ?? '')
      } else {
        setCurrentUserId(null)
        setCurrentUserLevel('')
      }

      if (activeTab === 'players') {
        let query = supabase.from('proffiles').select('id, full_name, email, region, level, elo_rating, avatar_url').not('email', 'like', `%${DELETED_PROFILE_EMAIL_DOMAIN}`)
        const search = searchTerm.trim()
        if (search) query = query.ilike('full_name', `%${search}%`)
        query = query.gte('elo_rating', filterEloMin).lte('elo_rating', filterEloMax)
        const { data, error: playersError } = await query.order('elo_rating', { ascending: false })
        if (playersError) throw playersError
        setPlayers(((data ?? []) as Player[]).filter((player) =>
          (filterRegion === 'Všetky kraje' || normalizeFilterValue(player.region ?? '') === normalizeFilterValue(filterRegion)) &&
          (filterLevel === 'Všetky úrovne' || normalizeFilterValue(player.level ?? '') === normalizeFilterValue(filterLevel))))
      } else {
        const normalizedRegion = normalizeFilterValue(listingRegion)
        const normalizedLevel = normalizeFilterValue(listingLevel)
        const showAllRegions = !normalizedRegion || ['vsetky kraje', 'cele slovensko'].includes(normalizedRegion)
        const showAllLevels = !normalizedLevel || ['vsetky urovne', 'vsetky urovne hraca'].includes(normalizedLevel)
        const { data, error: listingsError } = await supabase
          .from('player_requests')
          .select('*, proffiles(full_name, email)')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
        if (listingsError) throw listingsError
        setListings(((data ?? []) as Listing[]).filter((listing) =>
          (showAllRegions || normalizeFilterValue(listing.region) === normalizedRegion) &&
          (showAllLevels || normalizeFilterValue(listing.level ?? '') === normalizedLevel)))
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : JSON.stringify(loadError)
      setError(message || 'Údaje sa nepodarilo načítať.')
      console.error('Načítanie matchmaking údajov zlyhalo:', loadError)
    } finally {
      setLoading(false)
    }
  }, [activeTab, searchTerm, filterRegion, filterLevel, filterEloMin, filterEloMax, listingRegion, listingLevel, supabase])

  useEffect(() => {
    void fetchUserAndData()
  }, [fetchUserAndData])

  useEffect(() => {
    if (activeTab !== 'listings') return
    const channel = supabase
      .channel('player-requests-route-refresh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_requests' }, () => {
        void fetchUserAndData()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [activeTab, fetchUserAndData, supabase])

  function changeRequestType(value: string) {
    const nextCount = REQUEST_TYPES.find((type) => type.value === value)?.existingPlayers ?? 1
    setRequestType(value)
    setParticipants((current) => Array.from({ length: nextCount }, (_, index) => current[index] ?? ''))
  }

  async function handleCreateListing(event: FormEvent) {
    event.preventDefault()
    if (!currentUserId) {
      window.alert('Musíš byť prihlásený!')
      return
    }

    const participantsArray = participants.slice(0, participantFieldCount).map((name) => name.trim())
    if (participantsArray.some((name) => !name)) {
      setError(`Vyplň mená všetkých ${participantFieldCount} zúčastnených hráčov.`)
      return
    }
    const { error: insertError } = await supabase.from('player_requests').insert({
      user_id: currentUserId,
      request_type: requestType,
      region,
      level: currentUserLevel || null,
      match_date: matchDate || null,
      match_time: matchTime || null,
      participants_names: participantsArray.join(', '),
      ...(note.trim() ? { note: note.trim() } : {}),
      is_active: true,
    })

    if (insertError) {
      window.alert(`Chyba pri vytváraní inzerátu: ${insertError.message}`)
      return
    }

    setShowCreateModal(false)
    setNote('')
    setMatchDate('')
    setMatchTime('')
    setParticipants(Array.from({ length: participantFieldCount }, () => ''))
    await fetchUserAndData()
  }

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault()
    if (!selectedListing || !currentUserId) return

    const { error: insertError } = await supabase.from('messages').insert({
      sender_id: currentUserId,
      receiver_id: selectedListing.user_id,
      content: messageContent.trim(),
      request_id: selectedListing.id,
      is_read: false,
    })

    if (insertError) {
      window.alert(`Chyba pri odosielaní správy: ${insertError.message}`)
      return
    }

    window.alert('Správa bola úspešne odoslaná do schránky!')
    setSelectedListing(null)
    setMessageContent('')
  }

  const fieldClass = 'w-full rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]'
  const cardClass = 'rounded-xl border border-white/[0.08] bg-[#111722] p-5'

  return (
    <main className="mx-auto min-h-screen max-w-[1200px] px-4 py-8 text-white sm:px-8">
      <header className="flex flex-col justify-between gap-5 border-b border-white/10 pb-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ccff00]">SPL / HRÁČI</p>
          <h1 className="mt-2 text-3xl font-black">Padel Matchmaking</h1>
        </div>
        <nav className="flex gap-2" aria-label="Matchmaking">
          <button type="button" onClick={() => setActiveTab('players')} aria-pressed={activeTab === 'players'} className={`rounded-lg px-4 py-2.5 text-sm font-bold ${activeTab === 'players' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-white/10 text-white/65'}`}>Nájsť hráča</button>
          <button type="button" onClick={() => setActiveTab('listings')} aria-pressed={activeTab === 'listings'} className={`rounded-lg px-4 py-2.5 text-sm font-bold ${activeTab === 'listings' ? 'bg-[#ccff00] text-[#10150d]' : 'border border-white/10 text-white/65'}`}>Inzeráty</button>
        </nav>
      </header>

      {activeTab === 'players' ? (
        <section className="pt-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold">Burza hráčov</h2>
            <button type="button" onClick={() => setActiveTab('listings')} className="text-sm font-bold text-[#ccff00]">Pozrieť inzeráty →</button>
          </div>
          <div className="mt-5 grid gap-4 rounded-xl border border-white/10 bg-[#111722] p-4 md:grid-cols-5">
            <label className="grid gap-1.5 text-xs font-bold text-white/55 md:col-span-5">Hľadať podľa mena<input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Zadaj meno hráča" className={fieldClass} /></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Kraj<select value={filterRegion} onChange={(event) => setFilterRegion(event.target.value)} className={fieldClass}><option value="Všetky kraje">Všetky kraje</option>{REGIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Úroveň<select value={filterLevel} onChange={(event) => setFilterLevel(event.target.value)} className={fieldClass}><option value="">Všetky úrovne</option>{['Začiatočník', 'Mierne pokročilý', 'Pokročilý', 'Expert'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Minimálne ELO: {filterEloMin}<input type="range" min="0" max="10000" step="100" value={filterEloMin} onChange={(event) => setFilterEloMin(Number(event.target.value))} /></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Maximálne ELO: {filterEloMax}<input type="range" min="0" max="10000" step="100" value={filterEloMax} onChange={(event) => setFilterEloMax(Number(event.target.value))} /></label>
            <button type="button" onClick={() => { setSearchTerm(''); setFilterRegion('Všetky kraje'); setFilterLevel('Všetky úrovne'); setFilterEloMin(0); setFilterEloMax(10000) }} className="self-end rounded-lg border border-white/10 px-3 py-2.5 text-xs font-bold text-white/70 hover:border-[#ccff00]/50">Zrušiť filtre</button>
          </div>
          {error ? <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
          {loading ? <p role="status" className="py-12 text-center text-sm text-white/50">Načítavam hráčov…</p> : (
            <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {players.map((player) => <li key={player.id} className={cardClass}>
                <div className="flex items-center gap-3">{player.avatar_url ? <img src={player.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ccff00] font-black text-[#10150d]">{player.full_name?.slice(0, 1) || '?'}</span>}<h3 className="text-lg font-bold">{player.full_name || 'Neznámy hráč'}</h3></div>
                <p className="mt-1 text-sm text-white/55">Kraj: {player.region || 'Nezadaný'}</p>
                <p className="mt-1 text-sm text-white/55">Úroveň: {player.level || 'Nezadaná'}</p>
                <p className="mt-3 text-sm font-bold text-[#ccff00]">ELO: {player.elo_rating ?? 1000}</p>
              </li>)}
              {!players.length && !error && !loading ? <li className={`${cardClass} text-sm text-white/50`}>Nenašli sa žiadni hráči s vybranými filtrami.</li> : null}
            </ul>
          )}
        </section>
      ) : (
        <section className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-bold">Inzeráty hráčov</h2>
            <button type="button" onClick={() => setShowCreateModal(true)} className="rounded-lg bg-[#ccff00] px-4 py-2.5 text-sm font-black text-[#10150d]">+ Vytvoriť inzerát</button>
          </div>
          <div className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Filtrovať podľa kraja<select value={listingRegion} onChange={(event) => setListingRegion(event.target.value)} className={fieldClass}><option value="">Všetky kraje</option>{REGIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Úroveň vyzývateľa<select value={listingLevel} onChange={(event) => setListingLevel(event.target.value)} className={fieldClass}><option value="">Všetky úrovne</option>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          {error ? <p role="alert" className="mt-5 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
          {loading ? <p role="status" className="py-12 text-center text-sm text-white/50">Načítavam inzeráty…</p> : (
            <ul className="mt-5 grid gap-4 md:grid-cols-2">
              {listings.map((listing) => <li key={listing.id} className={`${cardClass} flex flex-col justify-between`}>
                <div>
                  <span className="rounded-full bg-[#ccff00]/10 px-2.5 py-1 text-xs font-semibold text-[#ccff00]">{REQUEST_TYPES.find((type) => type.value === listing.request_type)?.label ?? listing.request_type}</span>
                  <p className="mt-3 text-sm">Kraj: {listing.region}</p>
                  <p className="mt-1 text-sm text-white/55">Úroveň: {listing.level || 'Neuvedená'}</p>
                  {listing.match_date || listing.match_time ? <p className="mt-1 text-sm text-white/55">Termín: {listing.match_date ? new Date(`${listing.match_date}T00:00:00`).toLocaleDateString('sk-SK') : ''}{listing.match_date && listing.match_time ? ' · ' : ''}{listing.match_time ?? ''}</p> : null}
                  {listing.participants_names?.trim() ? <p className="mt-2 text-sm text-white/55">Hráči: {listing.participants_names}</p> : null}
                  {listing.note ? <p className="mt-3 rounded-lg bg-white/[0.04] p-3 text-sm italic text-white/70">{listing.note}</p> : null}
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-3">
                  <span className="text-xs text-white/45">Autor: {listing.proffiles?.full_name || 'Neznámy'}</span>
                  <button type="button" onClick={() => setSelectedListing(listing)} className="text-sm font-bold text-[#ccff00]">Reagovať správou</button>
                </div>
              </li>)}
              {!listings.length && !error && !loading ? <li className={`${cardClass} text-sm text-white/50`}>Zatiaľ tu nie sú žiadne aktívne inzeráty.</li> : null}
            </ul>
          )}
        </section>
      )}

      {showCreateModal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111722] p-6">
          <h2 className="text-lg font-bold">Nový inzerát</h2>
          <form onSubmit={handleCreateListing} className="mt-4 space-y-4">
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Typ inzerátu<select value={requestType} onChange={(event) => changeRequestType(event.target.value)} className={fieldClass}>{REQUEST_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Kraj<select required value={region} onChange={(event) => setRegion(event.target.value)} className={fieldClass}><option value="">Vyber kraj</option>{REGIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Dátum (voliteľné)<input type="date" value={matchDate} onChange={(event) => setMatchDate(event.target.value)} className={fieldClass} /></label>
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Čas (voliteľné)<input type="time" value={matchTime} onChange={(event) => setMatchTime(event.target.value)} className={fieldClass} /></label>
            <p className="text-xs text-white/50">Úroveň vyzývateľa: <span className="font-semibold text-white/75">{currentUserLevel || 'Neuvedená v profile'}</span></p>
            {participants.map((participant, index) => <label key={index} className="grid gap-1.5 text-xs font-bold text-white/55">Hráč {index + 1}<input required value={participant} onChange={(event) => setParticipants((current) => current.map((name, slot) => slot === index ? event.target.value : name))} placeholder={`Meno hráča ${index + 1}`} className={fieldClass} /></label>)}
            <label className="grid gap-1.5 text-xs font-bold text-white/55">Poznámka<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Hráme v utorok o 18:00…" className={fieldClass} /></label>
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
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setSelectedListing(null)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70">Zrušiť</button><button type="submit" className="rounded-lg bg-[#ccff00] px-4 py-2 text-sm font-bold text-[#10150d]">Odoslať</button></div>
          </form>
        </div>
      </div> : null}
    </main>
  )
}
