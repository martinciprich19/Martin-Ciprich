'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { ArrowLeft, Check, ChevronRight, Clock3, MapPin, Phone, Trash2, Trophy, UserPlus, UserRound, X } from 'lucide-react'
import { AppBackground } from '@/components/app-background'
import { MatchDetailModal } from '@/components/match-detail-modal'
import { useLanguage } from '@/components/language-provider'
import { getErrorMessage } from '@/lib/errors'
import { fetchProfileMatches, isCountedMatch } from '@/lib/profile-matches'
import { fetchPlayerProfile, fetchPublicPlayerProfile, fetchVisiblePlayerPhone } from '@/lib/profiles'
import { fetchFriendshipStatus, removeFriendship, sendFriendRequest, type FriendshipStatus } from '@/lib/friendships'
import { createClient } from '@/lib/supabase/client'

export default function PublicPlayerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { language, t } = useLanguage()
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null)
  const [currentProfileId, setCurrentProfileId] = useState<number | null>(null)
  const [friendshipStatus, setFriendshipStatus] = useState<FriendshipStatus>('none')
  const [friendshipLoading, setFriendshipLoading] = useState(true)
  const [friendRequestSending, setFriendRequestSending] = useState(false)
  const [friendshipRemoving, setFriendshipRemoving] = useState(false)
  const { data: player, error: playerError, isLoading: playerLoading } = useSWR(id ? ['public-player', id] : null, ([, profileId]) => fetchPublicPlayerProfile(profileId))
  const { data: matches = [], error: matchesError, isLoading: matchesLoading } = useSWR(id ? ['public-player-matches', id] : null, ([, profileId]) => fetchProfileMatches(profileId))
  const { data: phone } = useSWR(id ? ['public-player-phone', id] : null, ([, profileId]) => fetchVisiblePlayerPhone(profileId))

  useEffect(() => {
    let isActive = true
    async function loadFriendship() {
      if (!player) return
      try {
        const { data: { user }, error } = await createClient().auth.getUser()
        if (error) throw error
        const viewer = user?.email ? await fetchPlayerProfile(user.email) : null
        if (!isActive) return
        setCurrentProfileId(viewer?.id ?? null)
        if (!viewer || viewer.id === player.id) {
          setFriendshipStatus('none')
          return
        }
        setFriendshipStatus(await fetchFriendshipStatus(viewer.id, player.id))
      } catch (error: unknown) {
        console.error('Stav priateľstva sa nepodarilo načítať:', getErrorMessage(error, 'Stav priateľstva sa nepodarilo načítať.'))
      } finally {
        if (isActive) setFriendshipLoading(false)
      }
    }
    setFriendshipLoading(true)
    void loadFriendship()
    return () => { isActive = false }
  }, [player])

  async function addFriend() {
    if (!currentProfileId || !player || friendshipStatus !== 'none') return
    setFriendRequestSending(true)
    try {
      await sendFriendRequest(currentProfileId, player.id)
      setFriendshipStatus('pending_sent')
    } catch (error: unknown) {
      if (currentProfileId !== null) setFriendshipStatus(await fetchFriendshipStatus(currentProfileId, player.id).catch((): FriendshipStatus => 'none'))
      window.alert(getErrorMessage(error, t('Žiadosť o priateľstvo sa nepodarilo odoslať.')))
    } finally {
      setFriendRequestSending(false)
    }
  }

  async function removeFriend() {
    if (!currentProfileId || !player || friendshipStatus !== 'accepted') return
    setFriendshipRemoving(true)
    try {
      await removeFriendship(currentProfileId, player.id)
      setFriendshipStatus('none')
    } catch (error: unknown) {
      window.alert(getErrorMessage(error, t('Priateľa sa nepodarilo odstrániť.')))
    } finally {
      setFriendshipRemoving(false)
    }
  }

  useEffect(() => {
    if (!avatarOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAvatarOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [avatarOpen])

  const countedMatches = matches.filter(isCountedMatch)
  const wins = countedMatches.filter((match) => match.result === 'win').length
  const losses = countedMatches.length - wins
  const stats = [
    { label: t('ELO rating', 'ELO rating'), value: player?.elo_rating ?? '–' },
    { label: t('ELO od registrácie', 'ELO since registration'), value: player?.career_elo ?? '–' },
    { label: t('Najvyššie ELO', 'Highest ELO'), value: player?.highest_elo ?? '–' },
    { label: t('Zápasy', 'Matches'), value: matchesLoading ? '–' : countedMatches.length },
    { label: t('Výhry', 'Wins'), value: matchesLoading ? '–' : wins },
    { label: t('Prehry', 'Losses'), value: matchesLoading ? '–' : losses },
    { label: t('Úspešnosť', 'Win rate'), value: countedMatches.length ? `${Math.round((wins / countedMatches.length) * 100)}%` : '0%' },
    { label: t('Vyhraté sety', 'Sets won'), value: matchesLoading ? '–' : countedMatches.reduce((sum, match) => sum + match.sets_won, 0) },
    { label: t('Prehraté sety', 'Sets lost'), value: matchesLoading ? '–' : countedMatches.reduce((sum, match) => sum + match.sets_lost, 0) },
    { label: t('Vyhraté gemy', 'Games won'), value: matchesLoading ? '–' : countedMatches.reduce((sum, match) => sum + match.games_won, 0) },
    { label: t('Prehraté gemy', 'Games lost'), value: matchesLoading ? '–' : countedMatches.reduce((sum, match) => sum + match.games_lost, 0) },
  ]

  return (
    <main className="relative isolate min-h-screen bg-[#0b0f17] text-white">
      <AppBackground />
      <div className="mx-auto max-w-[1120px] px-4 py-8 md:px-8 md:py-12">
        <Link href="/profile?view=opponents" className="inline-flex items-center gap-2 text-sm font-bold text-white/55 hover:text-[#ccff00]">
          <ArrowLeft size={16} aria-hidden="true" /> {t('Späť na hráčov', 'Back to players')}
        </Link>

        {playerLoading ? <p role="status" className="mt-8 rounded-xl border border-white/10 bg-[#111722] p-8 text-center text-white/50">{t('Načítavam profil hráča…', 'Loading player profile…')}</p> : playerError ? (
          <p role="alert" className="mt-8 rounded-xl border border-red-400/30 bg-red-500/10 p-6 text-red-200">{getErrorMessage(playerError, t('Profil hráča sa nepodarilo načítať.', 'Could not load player profile.'))}</p>
        ) : !player ? (
          <p className="mt-8 rounded-xl border border-white/10 bg-[#111722] p-8 text-center text-white/50">{t('Profil hráča sa nenašiel.', 'Player profile not found.')}</p>
        ) : (
          <>
            <header className="mt-8 border-b border-white/10 pb-7">
              {player.avatar_url ? <button type="button" onClick={() => setAvatarOpen(true)} aria-label={t('Zväčšiť profilovú fotografiu', 'Enlarge profile photo')} className="mb-5 block cursor-zoom-in rounded-full"><img src={player.avatar_url} alt={t('Profilová fotografia', 'Profile photo')} className="h-20 w-20 rounded-full object-cover ring-2 ring-white/10" /></button> : null}
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#ccff00]">RIVA / {t('Profil hráča', 'PLAYER PROFILE')}</p>
              <h1 className="mt-3 text-3xl font-black md:text-4xl">{player.full_name}</h1>
              <p className="mt-3 flex items-center gap-2 text-sm text-white/50"><MapPin size={15} aria-hidden="true" /> {player.region || t('Kraj neuvedený', 'Region not specified')} · {player.level || t('Úroveň neuvedená', 'Level not specified')}</p>
              {currentProfileId !== null && currentProfileId !== player.id ? friendshipStatus === 'accepted' ? <button type="button" disabled={friendshipLoading || friendshipRemoving} onClick={() => void removeFriend()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-400/30 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50">
                <Trash2 size={14} />{friendshipRemoving ? t('Odstraňujem…', 'Removing…') : t('Odstrániť priateľa', 'Remove friend')}
              </button> : <button type="button" disabled={friendshipLoading || friendRequestSending || friendshipStatus !== 'none'} onClick={() => void addFriend()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/75 hover:border-[#ccff00]/50 disabled:cursor-not-allowed disabled:opacity-50">
                {friendshipStatus === 'pending_sent' ? <Clock3 size={14} /> : friendshipStatus === 'pending_received' ? <UserRound size={14} /> : <UserPlus size={14} />}
                {friendRequestSending ? t('Odosielam…', 'Sending…') : friendshipLoading ? t('Načítavam…', 'Loading…') : friendshipStatus === 'pending_sent' ? t('Žiadosť odoslaná', 'Request sent') : friendshipStatus === 'pending_received' ? t('Čaká na tvoju odpoveď', 'Request awaiting response') : t('Pridať priateľa', 'Add friend')}
              </button> : null}
              {phone ? <p className="mt-3 flex items-center gap-2 text-sm text-white/65"><Phone size={15} aria-hidden="true" /> {phone}</p> : null}
            </header>

            {player.bio.trim() ? <section className="mt-7 rounded-xl border border-white/[0.08] bg-[#111722] p-5"><h2 className="text-sm font-bold">{t('Profilový popis', 'About me')}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/65">{player.bio}</p></section> : null}

            <section aria-label={t('Štatistiky hráča', 'Player statistics')} className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {stats.map((stat) => <article key={stat.label} className="rounded-xl border border-white/[0.08] bg-[#111722] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{stat.label}</p><p className="mt-3 text-2xl font-black text-[#ccff00]">{stat.value}</p></article>)}
            </section>

            <section className="mt-10">
              <div className="flex items-center gap-3 border-b border-white/10 pb-4"><Trophy size={19} className="text-[#ccff00]" aria-hidden="true" /><h2 className="text-xl font-black">{t('História zápasov', 'Match history')}</h2><span className="ml-auto text-xs text-white/40">{matches.length}</span></div>
              {matchesLoading ? <p role="status" className="py-10 text-center text-sm text-white/45">{t('Načítavam históriu zápasov…', 'Loading match history…')}</p> : matchesError ? (
                <p role="alert" className="py-8 text-sm text-red-300">{getErrorMessage(matchesError, t('Históriu zápasov sa nepodarilo načítať.', 'Could not load match history.'))}</p>
              ) : matches.length === 0 ? (
                <p className="py-12 text-center text-sm text-white/45">{t('Hráč zatiaľ nemá žiadne schválené zápasy.', 'This player has no approved matches yet.')}</p>
              ) : (
                <ol className="divide-y divide-white/[0.07]">
                  {matches.map((match) => {
                    const isWin = match.result === 'win'
                    return <li key={match.id}><button type="button" onClick={() => setDetailMatchId(match.id)} aria-label={t(`Detail zápasu proti ${match.opponent_name}`, `Match details vs ${match.opponent_name}`)} className="group -mx-3 flex w-[calc(100%+1.5rem)] flex-col gap-3 rounded-lg px-3 py-5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ccff00] sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="font-bold">{match.opponent_name}</p><time dateTime={match.match_date} className="mt-1 block text-xs text-white/45">{new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sk-SK', { dateStyle: 'medium' }).format(new Date(match.match_date))}</time></div>
                      <div className="flex items-center gap-4"><p className="text-xs text-white/55">{t('Sety', 'Sets')}: {match.sets_won} : {match.sets_lost} <span className="mx-1 text-white/20">·</span> {t('Gemy', 'Games')}: {match.games_won} : {match.games_lost}</p><span className={`rounded-md px-2.5 py-1.5 text-[10px] font-black ${isWin ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'}`}>{isWin ? t('VÝHRA', 'WIN') : t('PREHRA', 'LOSS')}</span><ChevronRight size={16} aria-hidden="true" className="hidden text-white/25 transition-colors group-hover:text-[#ccff00] sm:block" /></div>
                    </button></li>
                  })}
                </ol>
              )}
            </section>
            {detailMatchId ? <MatchDetailModal matchId={detailMatchId} currentProfileId={currentProfileId} onClose={() => setDetailMatchId(null)} /> : null}
            {player.avatar_url && avatarOpen ? <div role="dialog" aria-modal="true" aria-label={t('Profilová fotografia', 'Profile photo')} onClick={() => setAvatarOpen(false)} className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/85 p-4">
              <button type="button" onClick={() => setAvatarOpen(false)} aria-label={t('Zavrieť', 'Close')} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><X size={20} /></button>
              <img src={player.avatar_url} alt={t('Profilová fotografia', 'Profile photo')} onClick={(event) => event.stopPropagation()} className="max-h-[85vh] max-w-[90vw] cursor-default rounded-2xl object-contain shadow-2xl" />
            </div> : null}
          </>
        )}
      </div>
    </main>
  )
}
