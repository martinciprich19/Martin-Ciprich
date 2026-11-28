'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { MessageSquare, UserPlus, UserRound, Users } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { PlayerAvatar } from '@/components/player-avatar'
import { getErrorMessage } from '@/lib/errors'
import { fetchFriends, type Friend } from '@/lib/friendships'
import { fetchFriendPairStatuses, sendPairInvitation } from '@/lib/pairs'

export function FriendsView({ myProfileId, profileError, onMessage, onFindPlayers }: {
  myProfileId: number | null
  profileError: string | null
  onMessage: (friend: Friend) => void
  onFindPlayers: () => void
}) {
  const { language } = useLanguage()
  const text = (sk: string, en: string, nl: string) => language === 'nl' ? nl : language === 'en' ? en : sk
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const inviting = useRef(false)
  const [inviteError, setInviteError] = useState('')
  const [feedback, setFeedback] = useState('')
  const { data: friends, error, isLoading, mutate } = useSWR(
    myProfileId !== null ? ['friends', myProfileId] : null,
    ([, id]) => fetchFriends(id),
    { shouldRetryOnError: false },
  )
  const pairStatuses = useSWR(
    myProfileId !== null ? ['friend-pair-statuses', myProfileId] : null,
    ([, id]) => fetchFriendPairStatuses(id),
    { shouldRetryOnError: false, refreshInterval: 15000 },
  )

  useEffect(() => {
    const refresh = () => { void mutate(); void pairStatuses.mutate() }
    window.addEventListener('communications-updated', refresh)
    window.addEventListener('communications-realtime-updated', refresh)
    return () => {
      window.removeEventListener('communications-updated', refresh)
      window.removeEventListener('communications-realtime-updated', refresh)
    }
  }, [mutate, pairStatuses.mutate])

  async function invite(friend: Friend) {
    if (inviting.current) return
    inviting.current = true
    setInvitingId(friend.id)
    setInviteError('')
    setFeedback('')
    try {
      await sendPairInvitation(friend.id)
      await pairStatuses.mutate((current) => ({ ...current, [friend.id]: 'invited' }), { revalidate: false })
      setFeedback(text(`Pozvánka pre ${friend.name} bola odoslaná. Dvojica vznikne po jej prijatí.`, `Invitation sent to ${friend.name}. The pair is created after acceptance.`, `Uitnodiging verzonden naar ${friend.name}. Het duo wordt aangemaakt na acceptatie.`))
      void pairStatuses.mutate()
    } catch (error) {
      console.error('Pozvanie do dvojice zlyhalo:', error)
      setInviteError(getErrorMessage(error, text('Pozvánku sa nepodarilo odoslať.', 'Could not send the invitation.', 'De uitnodiging kon niet worden verzonden.')))
      void pairStatuses.mutate()
    } finally {
      inviting.current = false
      setInvitingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[1120px]">
      <h1 className="text-2xl font-black md:text-3xl">{text('Priatelia', 'Friends', 'Vrienden')}</h1>
      <p className="mt-2 text-sm text-app-fg/55">{text('Tvoji potvrdení priatelia v RIVA Padel.', 'Your accepted friends in RIVA Padel.', 'Je bevestigde vrienden in RIVA Padel.')}</p>
      {feedback ? <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-app-emerald-300">{feedback}</p> : null}
      {inviteError ? <p role="alert" className="mt-4 text-sm text-app-red-300">{inviteError}</p> : null}
      {pairStatuses.error ? <div role="alert" className="mt-4 text-sm text-app-red-300">{text('Stav dvojíc sa nepodarilo načítať.', 'Could not load pair statuses.', 'De duostatus kon niet worden geladen.')} <button type="button" onClick={() => void pairStatuses.mutate()} className="font-bold underline">{text('Skúsiť znova', 'Try again', 'Opnieuw proberen')}</button></div> : null}
      {myProfileId === null && profileError ? (
        <p role="alert" className="mt-6 text-sm text-app-red-300">{profileError}</p>
      ) : myProfileId === null || isLoading ? (
        <p role="status" className="mt-6 text-sm text-app-fg/55">{text('Načítavam priateľov…', 'Loading friends…', 'Vrienden laden…')}</p>
      ) : error ? (
        <div role="alert" className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/[0.04] p-5">
          <p className="text-sm text-app-red-200">{getErrorMessage(error, text('Priateľov sa nepodarilo načítať.', 'Could not load friends.', 'Vrienden konden niet worden geladen.'))}</p>
          <button type="button" onClick={() => void mutate()} className="mt-3 text-xs font-bold text-app-league underline">{text('Skúsiť znova', 'Try again', 'Opnieuw proberen')}</button>
        </div>
      ) : !friends?.length ? (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-app-line/10 p-10 text-center">
          <Users size={32} className="text-app-league" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-bold">{text('Zatiaľ nemáš žiadnych priateľov', "You don't have any friends yet", 'Je hebt nog geen vrienden')}</h2>
          <p className="mt-2 text-sm text-app-fg/55">{text('Pridaj hráča z jeho profilu a počkaj na prijatie žiadosti.', 'Add a player from their profile and wait for them to accept.', 'Voeg een speler toe via het profiel en wacht tot het verzoek is geaccepteerd.')}</p>
          <button type="button" onClick={onFindPlayers} className="mt-4 rounded-lg bg-[#ccff00] px-4 py-2 text-xs font-bold text-[#10150d]">{text('Nájsť hráčov', 'Find players', 'Spelers zoeken')}</button>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {friends.map((friend) => (
            <li key={friend.id} className="rounded-2xl border border-app-line/10 bg-app-surface p-4">
              <div className="flex items-center gap-3">
                <PlayerAvatar name={friend.name} src={friend.avatarUrl} gender={friend.gender} />
                <div className="min-w-0">
                  <p className="truncate font-bold">{friend.name}</p>
                  <p className="mt-1 text-xs text-app-fg/50">{friend.region || text('Kraj neuvedený', 'Region not specified', 'Regio niet opgegeven')} · {friend.elo} ELO</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/players/${friend.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-app-line/10 px-3 py-2 text-xs font-bold text-app-fg/75 hover:text-app-fg"><UserRound size={14} />{text('Zobraziť profil', 'View profile', 'Bekijk profiel')}</Link>
                <button type="button" onClick={() => onMessage(friend)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#ccff00] px-3 py-2 text-xs font-bold text-[#10150d]"><MessageSquare size={14} />{text('Napísať správu', 'Send message', 'Bericht sturen')}</button>
                {pairStatuses.data?.[friend.id] === 'paired' ? (
                  <span className="inline-flex items-center px-2 py-2 text-xs text-app-fg/55">{text('Tvoríte dvojicu', 'You are a pair', 'Jullie vormen een duo')}</span>
                ) : pairStatuses.data?.[friend.id] === 'invited' ? (
                  <span className="inline-flex items-center px-2 py-2 text-xs text-app-fg/55">{text('Pozvánka odoslaná', 'Invitation sent', 'Uitnodiging verzonden')}</span>
                ) : pairStatuses.data?.[friend.id] === 'incoming' ? (
                  <span className="inline-flex items-center px-2 py-2 text-xs text-app-fg/55">{text('Pozvánka čaká v správach', 'Invitation waiting in messages', 'Uitnodiging wacht in berichten')}</span>
                ) : pairStatuses.data && !pairStatuses.error ? (
                  <button type="button" disabled={invitingId !== null} onClick={() => void invite(friend)} className="inline-flex items-center gap-1.5 rounded-lg border border-app-line/10 px-3 py-2 text-xs font-bold text-app-fg/75 hover:border-[#ccff00]/50 hover:text-app-fg disabled:opacity-50"><UserPlus size={14} />{invitingId === friend.id ? text('Odosielam…', 'Sending…', 'Verzenden…') : text('Vytvoriť dvojicu', 'Create a pair', 'Duo aanmaken')}</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
