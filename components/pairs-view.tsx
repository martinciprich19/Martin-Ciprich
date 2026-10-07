'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { ArrowLeft, Plus, Search, Swords, Users, X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { fetchPairs, sendPairInvitation, type PlayerPair } from '@/lib/pairs'
import { fetchFriends } from '@/lib/friendships'
import { getErrorMessage } from '@/lib/errors'

const fieldClass = 'w-full rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-2.5 text-sm text-white outline-none focus:border-[#ccff00]'

export function PairsView({ currentPlayerId, onChallenge, onBack }: { currentPlayerId: string | null; onChallenge: (pair: PlayerPair) => void; onBack: () => void }) {
  const { t } = useLanguage()
  const pairs = useSWR('league-pairs', fetchPairs)
  const friends = useSWR(currentPlayerId ? ['friends', currentPlayerId] : null, ([, id]) => fetchFriends(id))
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [friendId, setFriendId] = useState('')
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')

  const eligibleFriends = friends.data ?? []
  const regions = Array.from(new Set((pairs.data ?? []).flatMap((pair) => [pair.player_1.region, pair.player_2.region]).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'sk'))
  const visiblePairs = (pairs.data ?? [])
    .filter((pair) => {
      const normalizedSearch = search.trim().toLocaleLowerCase('sk')
      const matchesSearch = !normalizedSearch || `${pair.player_1.full_name} ${pair.player_2.full_name}`.toLocaleLowerCase('sk').includes(normalizedSearch)
      const matchesRegion = !regionFilter || pair.player_1.region === regionFilter || pair.player_2.region === regionFilter
      return matchesSearch && matchesRegion
    })
    .sort((left, right) => {
      const leftRegion = [left.player_1.region, left.player_2.region].filter(Boolean).sort((a, b) => a.localeCompare(b, 'sk')).join(' ')
      const rightRegion = [right.player_1.region, right.player_2.region].filter(Boolean).sort((a, b) => a.localeCompare(b, 'sk')).join(' ')
      return leftRegion.localeCompare(rightRegion, 'sk') || left.player_1.full_name.localeCompare(right.player_1.full_name, 'sk')
    })

  async function handleCreatePair(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!currentPlayerId || !friendId) {
      setError(t('Vyber priateľa, ktorého chceš pozvať.'))
      return
    }

    setIsSaving(true)
    try {
      await sendPairInvitation(friendId)
      setIsModalOpen(false)
      setFriendId('')
      setFeedback(t('Žiadosť o vytvorenie dvojice bola odoslaná.', 'Pair invitation sent.'))
    } catch (saveError: unknown) {
      const message = getErrorMessage(saveError, t('Dvojicu sa nepodarilo uložiť.'))
      console.error('Uloženie dvojice zlyhalo:', message)
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  return <div className="mx-auto max-w-[1120px]">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-white/55 hover:text-[#ccff00]"><ArrowLeft size={16} />{t('Späť na výzvu')}</button>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA /</p>
        <h1 className="mt-2 text-3xl font-black">{t('Dvojice')}</h1>
      </div>
      <button type="button" disabled={!currentPlayerId} onClick={() => { setError(''); setFeedback(''); setIsModalOpen(true) }} className="inline-flex items-center gap-2 rounded-lg bg-[#ccff00] px-4 py-2.5 text-sm font-black text-[#10150d] disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} />{t('Pozvať priateľa do dvojice', 'Invite a friend to pair')}</button>
    </header>

    <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
      <label className="relative block"><span className="sr-only">{t('Vyhľadať dvojicu')}</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Vyhľadať hráča v dvojici')} className={`${fieldClass} pl-9`} /></label>
      <label className="block"><span className="sr-only">{t('Filtrovať podľa kraja')}</span><select aria-label={t('Filtrovať podľa kraja')} value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)} className={fieldClass}><option value="">{t('Všetky kraje')}</option>{regions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
    </div>

    {feedback ? <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">{feedback}</p> : null}
    {pairs.error ? <p role="alert" className="mt-6 rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{getErrorMessage(pairs.error, t('Dvojice sa nepodarilo načítať.'))}</p> : null}
    {pairs.isLoading ? <p role="status" className="py-12 text-center text-sm text-white/50">{t('Načítavam dvojice…')}</p> : null}
    {!pairs.isLoading && !pairs.error && pairs.data?.length === 0 ? <div className="mt-6 rounded-xl border border-white/10 bg-[#111722] p-8 text-center"><Users className="mx-auto text-[#ccff00]" size={28} /><p className="mt-3 text-sm text-white/55">{t('Zatiaľ nie sú vytvorené žiadne dvojice.')}</p></div> : null}
    {!pairs.isLoading && !pairs.error && pairs.data?.length && !visiblePairs.length ? <div className="mt-6 rounded-xl border border-white/10 bg-[#111722] p-8 text-center text-sm text-white/55">{t('Žiadna dvojica nezodpovedá vyhľadávaniu.')}</div> : null}

    <ul className="mt-6 grid gap-4 md:grid-cols-2">
      {visiblePairs.map((pair) => {
        const isOwnPair = pair.player_1_id === currentPlayerId || pair.player_2_id === currentPlayerId
        return <li key={pair.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#111722] p-5">
          <div className="min-w-0">
            <p className="truncate font-bold">{pair.player_1.full_name} <span className="text-white/40">&</span> {pair.player_2.full_name}</p>
            <p className="mt-1 text-xs text-white/45">{[pair.player_1.region, pair.player_2.region].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" disabled={isOwnPair} onClick={() => onChallenge(pair)} title={isOwnPair ? t('Túto dvojicu nemôžeš vyzvať.') : t('Vyzvať')} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#ccff00]/25 px-3 py-2 text-xs font-bold text-[#ccff00] hover:bg-[#ccff00]/10 disabled:cursor-not-allowed disabled:opacity-40"><Swords size={14} />{isOwnPair ? t('Vaša dvojica') : t('Vyzvať')}</button>
        </li>
      })}
    </ul>

    {isModalOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) setIsModalOpen(false) }}>
      <form onSubmit={handleCreatePair} className="w-full max-w-md rounded-xl border border-white/10 bg-[#111722] p-6">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{t('Pozvať priateľa do dvojice', 'Invite a friend to pair')}</h2><button type="button" onClick={() => setIsModalOpen(false)} aria-label={t('Zavrieť')} className="text-white/50 hover:text-white"><X size={18} /></button></div>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-xs font-bold text-white/55">{t('Priateľ')}
            <select required value={friendId} onChange={(event) => setFriendId(event.target.value)} disabled={friends.isLoading || isSaving} className={fieldClass}>
              <option value="">{t('Vyber priateľa')}</option>
              {eligibleFriends.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
            </select>
          </label>
        </div>
        {friends.error ? <p role="alert" className="mt-3 text-sm text-red-300">{getErrorMessage(friends.error, t('Priateľov sa nepodarilo načítať.'))}</p> : null}
        {!friends.isLoading && !friends.error && !eligibleFriends.length ? <p className="mt-3 text-sm text-white/45">{t('Nemáš priateľov, ktorých môžeš pozvať.')}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setIsModalOpen(false)} disabled={isSaving} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70">{t('Zrušiť')}</button><button type="submit" disabled={isSaving || friends.isLoading || !eligibleFriends.length} className="rounded-lg bg-[#ccff00] px-4 py-2 text-sm font-bold text-[#10150d] disabled:opacity-50">{isSaving ? t('Odosielam…') : t('Odoslať žiadosť', 'Send invitation')}</button></div>
      </form>
    </div> : null}
  </div>
}