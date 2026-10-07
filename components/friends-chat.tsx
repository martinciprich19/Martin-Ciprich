'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR, { useSWRConfig } from 'swr'
import { Check, MessageSquare, Send, UserRound, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchFriends, fetchIncomingRequests, respondToFriendRequest, type Friend } from '@/lib/friendships'
import { fetchMessages, fetchUnreadMessagesBySender, sendMessage } from '@/lib/messages'
import { fetchIncomingPairInvitations, respondToPairInvitation } from '@/lib/pairs'
import { getErrorMessage } from '@/lib/errors'

type FriendsChatProps = {
  myProfileId: number | null
  activeFriendId: string | null
  setActiveFriendId: (id: string | null) => void
  onChallenge: (friend: Friend) => void
}

export function FriendsChat({ myProfileId, activeFriendId, setActiveFriendId, onChallenge }: FriendsChatProps) {
  const { mutate: mutateCache } = useSWRConfig()
  const friends = useSWR(myProfileId !== null ? ['friends', myProfileId] : null, ([, id]) => fetchFriends(id), { shouldRetryOnError: false })
  const requests = useSWR(myProfileId !== null ? ['friend-requests', myProfileId] : null, ([, id]) => fetchIncomingRequests(id), { shouldRetryOnError: false })
  const pairInvitations = useSWR(myProfileId !== null ? ['incoming-pair-invitations', myProfileId] : null, ([, id]) => fetchIncomingPairInvitations(id), { refreshInterval: 15000, revalidateOnFocus: true, shouldRetryOnError: false })
  const unreadMessages = useSWR(myProfileId !== null ? ['unread-messages-by-sender', myProfileId] : null, ([, id]) => fetchUnreadMessagesBySender(id), { refreshInterval: 30000, shouldRetryOnError: false })
  const activeFriend = friends.data?.find((friend) => friend.id === activeFriendId) ?? null

  useEffect(() => {
    const refresh = () => {
      void unreadMessages.mutate()
      void requests.mutate()
      void pairInvitations.mutate()
    }
    window.addEventListener('communications-updated', refresh)
    window.addEventListener('communications-realtime-updated', refresh)
    return () => {
      window.removeEventListener('communications-updated', refresh)
      window.removeEventListener('communications-realtime-updated', refresh)
    }
  }, [unreadMessages.mutate, requests.mutate, pairInvitations.mutate])

  useEffect(() => {
    if (myProfileId === null || activeFriendId === null) return
    const supabase = createClient()
    const friendId = activeFriendId
    void unreadMessages.mutate((current) => ({ ...current, [friendId]: 0 }), { revalidate: false })
    void (async () => {
      const { error } = await supabase.rpc('mark_messages_as_read', {
        p_sender_id: friendId,
      })

      if (error) {
        console.error('Správy sa nepodarilo označiť ako prečítané:', error.message)
        return
      }

      await Promise.all([unreadMessages.mutate(), friends.mutate()])
    })()
  }, [myProfileId, activeFriendId, unreadMessages.mutate, friends.mutate])

  async function respond(friendshipId: string, accept: boolean) {
    try {
      await respondToFriendRequest(friendshipId, accept)
      await Promise.all([requests.mutate(), friends.mutate()])
    } catch (error: unknown) {
      window.alert(getErrorMessage(error, 'Žiadosť sa nepodarilo spracovať.'))
    }
  }

  async function respondToPair(invitationId: string, accept: boolean) {
    try {
      await respondToPairInvitation(invitationId, accept)
      await Promise.all([
        pairInvitations.mutate(),
        friends.mutate(),
        mutateCache('league-pairs'),
      ])
      window.dispatchEvent(new Event('communications-updated'))
    } catch (error: unknown) {
      window.alert(getErrorMessage(error, 'Na pozvanie do dvojice sa nepodarilo odpovedať.'))
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {pairInvitations.error ? <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{getErrorMessage(pairInvitations.error, 'Žiadosti o vytvorenie dvojice sa nepodarilo načítať.')}</p> : null}
      {pairInvitations.data?.length ? (
        <section className="rounded-2xl border border-[#ccff00]/25 bg-[#131924] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ccff00]">Žiadosti o vytvorenie dvojice</p>
          <ul className="mt-3 space-y-2">
            {pairInvitations.data.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b0f17] px-3 py-2.5">
                <span className="text-sm font-bold">{invitation.inviterName} ťa pozýva vytvoriť dvojicu.</span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => void respondToPair(invitation.id, true)} className="inline-flex items-center gap-1 rounded-lg bg-[#ccff00] px-3 py-1.5 text-xs font-black text-[#10150d]"><Check size={13} />Prijať</button>
                  <button type="button" onClick={() => void respondToPair(invitation.id, false)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/65"><X size={13} />Odmietnuť</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {requests.data?.length ? (
        <section className="rounded-2xl border border-[#ccff00]/25 bg-[#131924] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ccff00]">Žiadosti o priateľstvo</p>
          <ul className="mt-3 space-y-2">
            {requests.data.map((request) => (
              <li key={request.friendshipId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0b0f17] px-3 py-2.5">
                <span className="truncate text-sm font-bold">{request.fromName}</span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => void respond(request.friendshipId, true)} className="inline-flex items-center gap-1 rounded-lg bg-[#ccff00] px-3 py-1.5 text-xs font-black text-[#10150d]"><Check size={13} />Prijať</button>
                  <button type="button" onClick={() => void respond(request.friendshipId, false)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/65"><X size={13} />Odmietnuť</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#131924] lg:grid lg:h-[640px] lg:grid-cols-[320px_1fr]">
        <div className={`${activeFriend ? 'hidden lg:block' : 'block'} overflow-y-auto border-r border-white/10 p-4`}>
          <p className="px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Priatelia</p>
          {activeFriendId && !activeFriend && !friends.isLoading ? <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/55">Tento hráč ešte nie je tvoj priateľ. Pridaj ho z jeho profilu v „Nájsť hráčov“.</p> : null}
          {friends.isLoading ? <p role="status" className="px-2 py-8 text-sm text-white/45">Načítavam priateľov…</p> : friends.error ? <p role="alert" className="px-2 py-8 text-sm text-red-300">{getErrorMessage(friends.error, 'Priateľov sa nepodarilo načítať.')}</p> : !friends.data?.length ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center px-4 text-center">
              <MessageSquare className="text-[#ccff00]" size={36} />
              <h2 className="mt-4 text-lg font-black">Zatiaľ nemáš žiadnych priateľov</h2>
              <p className="mt-2 text-xs leading-5 text-white/45">Pridaj hráča do priateľov z jeho profilu v „Nájsť hráčov“. Po prijatí žiadosti si môžete písať.</p>
            </div>
          ) : (
            <div className="mt-3 space-y-1">
              {friends.data.map((friend) => (
                <button key={friend.id} type="button" onClick={() => setActiveFriendId(friend.id)} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-white/5 ${friend.id === activeFriendId ? 'bg-white/10' : ''}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ccff00] text-xs font-black text-[#10150d]">{friend.name.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{friend.name}</span><span className="block truncate text-xs text-white/40">{friend.region || 'Kraj neuvedený'} · {friend.elo} ELO</span></span>
                  {unreadMessages.data?.[friend.id] ? <span aria-label={`${unreadMessages.data[friend.id]} neprečítaných správ`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{unreadMessages.data[friend.id] > 99 ? '99+' : unreadMessages.data[friend.id]}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`${activeFriend ? 'block' : 'hidden lg:block'} min-h-[480px] min-w-0 lg:h-full lg:min-h-0`}>
          {activeFriend && myProfileId !== null ? <Conversation myProfileId={myProfileId} friend={activeFriend} onBack={() => setActiveFriendId(null)} /> : <div className="flex min-h-[480px] items-center justify-center text-center text-sm text-white/35">Vyber priateľa zo zoznamu.</div>}
        </div>
      </div>
    </div>
  )
}

function Conversation({ myProfileId, friend, onBack }: { myProfileId: number; friend: Friend; onBack: () => void }) {
  const { data: messages = [], error, mutate } = useSWR(['messages', myProfileId, friend.id], ([, me, other]) => fetchMessages(me, other), { refreshInterval: 5000 })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setSendError('')
    try {
      await sendMessage(myProfileId, friend.id, content)
      setDraft('')
      await mutate()
    } catch (sendFailure: unknown) {
      setSendError(getErrorMessage(sendFailure, 'Správu sa nepodarilo odoslať.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-[70vh] flex-col lg:h-full">
      <div className="flex items-center gap-3 border-b border-white/10 p-5">
        <button type="button" onClick={onBack} className="text-sm text-white/50 lg:hidden">← Späť</button>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ccff00] text-xs font-black text-[#10150d]">{friend.name.slice(0, 1)}</span>
        <div className="flex-1"><p className="font-bold">{friend.name}</p><p className="text-xs text-white/40">{friend.region || 'Kraj neuvedený'} · {friend.elo} ELO</p></div>
        <Link href={`/players/${friend.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/75 hover:border-[#ccff00]/50 hover:text-white"><UserRound size={14} />Zobraziť profil</Link>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {error ? <p role="alert" className="text-center text-sm text-red-300">{getErrorMessage(error, 'Správy sa nepodarilo načítať.')}</p> : messages.length === 0 ? <p className="py-16 text-center text-sm text-white/35">Začni konverzáciu správou.</p> : messages.map((message) => {
          const received = message.receiverId === String(myProfileId)
          return (
            <div key={message.id} className={`flex ${received ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${received ? 'border border-white/10 bg-[#0b0f17] text-white/80' : 'bg-[#ccff00] text-[#10150d]'}`}>
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                <time dateTime={message.createdAt} className="mt-1 block text-[10px] opacity-50">{new Date(message.createdAt).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
      {sendError ? <p role="alert" className="px-4 pb-2 text-xs text-red-300">{sendError}</p> : null}
      <form onSubmit={(event) => void submit(event)} className="flex gap-2 border-t border-white/10 p-4">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Napíš správu..." maxLength={2000} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0b0f17] px-3 py-3 text-sm text-white outline-none focus:border-[#ccff00]" />
        <button type="submit" disabled={sending || !draft.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[#ccff00] px-4 py-3 text-xs font-black text-[#10150d] disabled:opacity-50"><Send size={15} />Odoslať</button>
      </form>
    </div>
  )
}
