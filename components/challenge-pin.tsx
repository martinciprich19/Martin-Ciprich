'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/components/language-provider'
import { getErrorMessage } from '@/lib/errors'

export function ChallengePin({ challengeId }: { challengeId: string }) {
  const { t } = useLanguage()
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null)
  const { data, error, isLoading, mutate } = useSWR(['challenge-pin', challengeId], async ([, id]) => {
    const result = await createClient().rpc('get_challenge_match_pin', { p_challenge_id: id })
    if (result.error) throw result.error
    if (!Array.isArray(result.data)) throw new Error(t('PIN sa nepodarilo načítať.', 'Could not load the PIN.'))
    return result.data[0] as { pin: string; activated: boolean } | undefined
  }, { refreshInterval: 15000 })

  async function retryEmails() {
    setSending(true)
    setFeedback(null)
    try {
      const response = await fetch('/api/challenge-pin-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId }),
      })
      const result: unknown = await response.json()
      if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : t('E-maily sa nepodarilo odoslať.', 'Could not send emails.'))
      setFeedback({ error: false, message: t('Čakajúce e-maily boli odoslané.', 'Pending emails were sent.') })
    } catch (sendError) {
      const message = getErrorMessage(sendError, t('E-maily sa nepodarilo odoslať.', 'Could not send emails.'))
      console.error('Odoslanie PIN-u výzvy zlyhalo:', message)
      setFeedback({ error: true, message })
    } finally { setSending(false) }
  }

  if (isLoading) return <p role="status" className="mt-3 text-xs text-app-fg/55">{t('Načítavam PIN…', 'Loading PIN…')}</p>
  if (error) return <div role="alert" className="mt-3 text-xs text-app-red-300">{getErrorMessage(error, t('PIN sa nepodarilo načítať.', 'Could not load the PIN.'))} <button type="button" onClick={() => void mutate()} className="font-bold underline">{t('Skúsiť znova', 'Try again')}</button></div>
  if (!data) return null
  return <div className="mt-3 rounded-lg border border-[#ccff00]/30 bg-[#ccff00]/10 p-3">
    <p className="text-sm font-bold">{t('PIN do zápasu', 'Match PIN')}: <span className="tracking-[0.2em]">{data.pin}</span></p>
    <p className="mt-1 text-xs text-app-fg/60">{data.activated ? t('PIN už bol použitý na spustenie zápasu.', 'The PIN has already been used to start the match.') : t('Zadaj PIN na tablete v aréne.', 'Enter the PIN on the arena tablet.')}</p>
    <button type="button" disabled={sending} onClick={() => void retryEmails()} className="mt-2 text-xs font-bold text-app-league underline disabled:opacity-50">{sending ? t('Odosielam…', 'Sending…') : t('Znovu odoslať čakajúce e-maily', 'Retry pending emails')}</button>
    {feedback ? <p role={feedback.error ? 'alert' : 'status'} className={`mt-2 text-xs ${feedback.error ? 'text-app-red-300' : 'text-app-emerald-300'}`}>{feedback.message}</p> : null}
  </div>
}
