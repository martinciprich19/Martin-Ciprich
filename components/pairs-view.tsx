'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { ArrowLeft, Plus, Search, Swords, Trash2, Users, X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { deletePair, fetchPairs, sendPairInvitation, type PlayerPair } from '@/lib/pairs'
import { fetchFriends } from '@/lib/friendships'
import { getErrorMessage } from '@/lib/errors'

const fieldClass = 'w-full rounded-lg border border-app-line/10 bg-app-canvas px-3 py-2.5 text-sm text-app-fg outline-none focus:border-[#ccff00]'

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
  const [pairToDelete, setPairToDelete] = useState<PlayerPair | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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

  async function handleDeletePair() {
    if (!pairToDelete || isDeleting) return
    const pair = pairToDelete
    setIsDeleting(true)
    setDeleteError('')
    try {
      await pairs.mutate(async (current: PlayerPair[] | undefined) => {
        await deletePair(pair.id)
        return (current ?? []).filter((item) => item.id !== pair.id)
      }, { revalidate: false })
      setPairToDelete(null)
      setFeedback(t('Dvojica bola zrušená.', 'Pair dissolved.'))
    } catch (error: unknown) {
      const message = getErrorMessage(error, t('Dvojicu sa nepodarilo zrušiť.', 'Could not dissolve the pair.'))
      console.error('Zrušenie dvojice zlyhalo:', message)
      setDeleteError(message)
    } finally {
      setIsDeleting(false)
    }
  }

  return <div className="mx-auto max-w-[1120px]">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-app-fg/55 hover:text-app-league"><ArrowLeft size={16} />{t('Späť na výzvu')}</button>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-app-league">RIVA /</p>
        <h1 className="mt-2 text-3xl font-black">{t('Dvojice')}</h1>
      </div>
      <button type="button" disabled={!currentPlayerId} onClick={() => { setError(''); setFeedback(''); setIsModalOpen(true) }} className="inline-flex items-center gap-2 rounded-lg bg-[#ccff00] px-4 py-2.5 text-sm font-black text-[#10150d] disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} />{t('Pozvať priateľa do dvojice', 'Invite a friend to pair')}</button>
    </header>

    <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
      <label className="relative block"><span className="sr-only">{t('Vyhľadať dvojicu')}</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-fg/35" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Vyhľadať hráča v dvojici')} className={`${fieldClass} pl-9`} /></label>
      <label className="block"><span className="sr-only">{t('Filtrovať podľa kraja')}</span><select aria-label={t('Filtrovať podľa kraja')} value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)} className={fieldClass}><option value="">{t('Všetky kraje')}</option>{regions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
    </div>

    {feedback ? <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-app-emerald-300">{feedback}</p> : null}
    {pairs.error ? <p role="alert" className="mt-6 rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-sm text-app-red-200">{getErrorMessage(pairs.error, t('Dvojice sa nepodarilo načítať.'))}</p> : null}
    {pairs.isLoading ? <p role="status" className="py-12 text-center text-sm text-app-fg/50">{t('Načítavam dvojice…')}</p> : null}
    {!pairs.isLoading && !pairs.error && pairs.data?.length === 0 ? <div className="mt-6 rounded-xl border border-app-line/10 bg-app-surface p-8 text-center"><Users className="mx-auto text-app-league" size={28} /><p className="mt-3 text-sm text-app-fg/55">{t('Zatiaľ nie sú vytvorené žiadne dvojice.')}</p></div> : null}
    {!pairs.isLoading && !pairs.error && pairs.data?.length && !visiblePairs.length ? <div className="mt-6 rounded-xl border border-app-line/10 bg-app-surface p-8 text-center text-sm text-app-fg/55">{t('Žiadna dvojica nezodpovedá vyhľadávaniu.')}</div> : null}

    <ul className="mt-6 grid gap-4 md:grid-cols-2">
      {visiblePairs.map((pair) => {
        const isOwnPair = pair.player_1_id === currentPlayerId || pair.player_2_id === currentPlayerId
        return <li key={pair.id} className="flex items-center justify-between gap-4 rounded-xl border border-app-line/[0.08] bg-app-surface p-5">
          <div className="min-w-0">
            <p className="truncate font-bold">{pair.player_1.full_name} <span className="text-app-fg/40">&</span> {pair.player_2.full_name}</p>
            <p className="mt-1 text-xs text-app-fg/45">{[pair.player_1.region, pair.player_2.region].filter(Boolean).join(' · ')}</p>
          </div>
          {isOwnPair ? <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-xs font-bold text-app-league">{t('Vaša dvojica')}</span>
            <button type="button" onClick={() => { setDeleteError(''); setFeedback(''); setPairToDelete(pair) }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-2 text-xs font-bold text-app-red-300 transition hover:bg-red-400/10"><Trash2 size={14} />{t('Zrušiť dvojicu', 'Dissolve pair')}</button>
          </div> : <button type="button" onClick={() => onChallenge(pair)} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#ccff00]/25 px-3 py-2 text-xs font-bold text-app-league hover:bg-[#ccff00]/10"><Swords size={14} />{t('Vyzvať')}</button>}
        </li>
      })}
    </ul>

    {pairToDelete ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onKeyDown={(event) => { if (event.key === 'Escape' && !isDeleting) setPairToDelete(null) }}>
      <section role="dialog" aria-modal="true" aria-labelledby="dissolve-pair-title" aria-describedby="dissolve-pair-description" className="w-full max-w-md rounded-2xl border border-app-line/10 bg-app-panel p-6">
        <h2 id="dissolve-pair-title" className="text-lg font-black">{t('Naozaj chceš zrušiť túto dvojicu?', 'Are you sure you want to dissolve this pair?')}</h2>
        <p className="mt-3 font-bold">{pairToDelete.player_1.full_name} & {pairToDelete.player_2.full_name}</p>
        <p id="dissolve-pair-description" className="mt-3 text-sm leading-relaxed text-app-fg/55">{t('Dvojica sa odstráni pre oboch hráčov. Existujúce výzvy a výsledky zápasov zostanú zachované.', 'The pair will be removed for both players. Existing challenges and match results will be preserved.')}</p>
        {deleteError ? <p role="alert" className="mt-4 text-sm text-app-red-300">{deleteError}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" autoFocus disabled={isDeleting} onClick={() => setPairToDelete(null)} className="rounded-lg border border-app-line/10 px-4 py-2 text-sm font-bold disabled:opacity-40">{t('Späť', 'Back')}</button>
          <button type="button" disabled={isDeleting} onClick={() => void handleDeletePair()} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{isDeleting ? t('Ruším…', 'Dissolving…') : t('Zrušiť dvojicu', 'Dissolve pair')}</button>
        </div>
      </section>
    </div> : null}

    {isModalOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) setIsModalOpen(false) }}>
      <form onSubmit={handleCreatePair} className="w-full max-w-md rounded-xl border border-app-line/10 bg-app-surface p-6">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{t('Pozvať priateľa do dvojice', 'Invite a friend to pair')}</h2><button type="button" onClick={() => setIsModalOpen(false)} aria-label={t('Zavrieť')} className="text-app-fg/50 hover:text-app-fg"><X size={18} /></button></div>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-xs font-bold text-app-fg/55">{t('Priateľ')}
            <select required value={friendId} onChange={(event) => setFriendId(event.target.value)} disabled={friends.isLoading || isSaving} className={fieldClass}>
              <option value="">{t('Vyber priateľa')}</option>
              {eligibleFriends.map((friend) => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
            </select>
          </label>
        </div>
        {friends.error ? <p role="alert" className="mt-3 text-sm text-app-red-300">{getErrorMessage(friends.error, t('Priateľov sa nepodarilo načítať.'))}</p> : null}
        {!friends.isLoading && !friends.error && !eligibleFriends.length ? <p className="mt-3 text-sm text-app-fg/45">{t('Nemáš priateľov, ktorých môžeš pozvať.')}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-app-red-300">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setIsModalOpen(false)} disabled={isSaving} className="rounded-lg border border-app-line/10 px-4 py-2 text-sm text-app-fg/70">{t('Zrušiť')}</button><button type="submit" disabled={isSaving || friends.isLoading || !eligibleFriends.length} className="rounded-lg bg-[#ccff00] px-4 py-2 text-sm font-bold text-[#10150d] disabled:opacity-50">{isSaving ? t('Odosielam…') : t('Odoslať žiadosť', 'Send invitation')}</button></div>
      </form>
    </div> : null}
  </div>
}