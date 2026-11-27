'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { X } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { getErrorMessage } from '@/lib/errors'
import { fetchChallengeDetails, type ChallengeProfile } from '@/lib/pair-challenges'
import { ChallengePin } from '@/components/challenge-pin'

export function ChallengeDetailModal({ challengeId, onClose }: { challengeId: string; onClose: () => void }) {
  const { language, t } = useLanguage()
  const { data, error, isLoading, mutate } = useSWR(['challenge-details', challengeId], ([, id]) => fetchChallengeDetails(id))
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const locale = language === 'nl' ? 'nl-NL' : language === 'en' ? 'en-GB' : 'sk-SK'

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus({ preventScroll: true })
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus?.({ preventScroll: true })
    }
  }, [])

  function player(id: string, profile: ChallengeProfile) {
    const record = Array.isArray(profile) ? profile[0] : profile
    const name = record?.full_name?.trim() || `${t('Hráč', 'Player')} ${id}`
    return <Link href={`/players/${encodeURIComponent(String(id))}`} className="block rounded-lg border border-app-line/10 px-3 py-2 text-sm font-bold text-app-league hover:bg-app-overlay/5">{name}</Link>
  }

  const challenge = data?.challenge
  const date = challenge ? new Date(challenge.match_date) : null
  const arena = data?.arena
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="challenge-detail-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-app-line/10 bg-app-panel p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 id="challenge-detail-title" className="text-lg font-black">{t('Detail výzvy', 'Challenge details')}</h2>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={t('Zavrieť', 'Close')} className="text-app-fg/55 hover:text-app-fg"><X size={20} /></button>
      </div>
      {isLoading ? <p role="status" className="mt-5 text-sm text-app-fg/55">{t('Načítavam detail výzvy…', 'Loading challenge details…')}</p> : null}
      {error ? <div role="alert" className="mt-5 text-sm text-app-red-300">
        <p>{getErrorMessage(error, t('Detail výzvy sa nepodarilo načítať.', 'Could not load challenge details.'))}</p>
        <button type="button" onClick={() => void mutate()} className="mt-3 rounded-lg border border-app-line/10 px-3 py-2 font-bold">{t('Skúsiť znova', 'Try again')}</button>
      </div> : null}
      {challenge && !error ? <div className="mt-5 space-y-5">
        {challenge.status === 'accepted' ? <ChallengePin challengeId={challengeId} /> : null}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-app-fg/50">{t('Vyzývajúca dvojica', 'Challenging pair')}</h3>
          <div className="mt-2 grid gap-2">{player(challenge.challenger_1_id, challenge.challenger_1)}{player(challenge.challenger_2_id, challenge.challenger_2)}</div>
        </div>
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-app-fg/50">{t('Vyzývaná dvojica', 'Challenged pair')}</h3>
          <div className="mt-2 grid gap-2">{player(challenge.challenged_1_id, challenge.challenged_1)}{player(challenge.challenged_2_id, challenge.challenged_2)}</div>
        </div>
        <div><h3 className="text-xs font-bold uppercase tracking-wider text-app-fg/50">{t('Dátum a čas', 'Date and time')}</h3>
          <p className="mt-1 text-sm font-semibold">{date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : t('Termín nie je dostupný.', 'Date and time unavailable.')}</p>
        </div>
        <div><h3 className="text-xs font-bold uppercase tracking-wider text-app-fg/50">{t('Miesto', 'Venue')}</h3>
          <p className="mt-1 text-sm font-semibold">{arena ? [arena.name, arena.city, arena.address].filter(Boolean).join(' · ') || t('Miesto nie je dostupné.', 'Venue unavailable.') : t('Miesto nie je dostupné.', 'Venue unavailable.')}</p>
        </div>
      </div> : null}
    </section>
  </div>
}
