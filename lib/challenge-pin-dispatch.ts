import 'server-only'
import { setTimeout as delay } from 'node:timers/promises'
import { createPushAdminClient } from '@/lib/firebase-admin'
import { isAppLanguage } from '@/lib/countries'
import { sendChallengePinEmail } from '@/lib/challenge-pin-email'

export async function dispatchChallengePinEmails(challengeId: string, profileId?: string) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MATCH_EMAIL_FROM
  if (!apiKey || !from) throw new Error('Chýba RESEND_API_KEY alebo MATCH_EMAIL_FROM.')
  const admin = createPushAdminClient()
  const { data: allJobs, error: jobsError } = await admin.from('challenge_pin_emails')
    .select('id, recipient_profile_id, sent_at').eq('challenge_id', challengeId)
    .order('recipient_profile_id')
  if (jobsError) throw jobsError
  const jobs = (allJobs ?? []).map((job, index) => ({ ...job, index }))
    .filter(job => !job.sent_at && (!profileId || String(job.recipient_profile_id) === profileId))
  if (!jobs?.length) return { sent: 0 }
  const { data: challenge, error: challengeError } = await admin.from('challenges')
    .select('status').eq('id', challengeId).maybeSingle()
  if (challengeError) throw challengeError
  if (challenge?.status !== 'accepted') throw new Error('Výzva už nie je potvrdená.')
  const { data: match, error: matchError } = await admin.from('live_matches')
    .select('match_pin, ended_early_at, result_finalized_at, official_result_id')
    .eq('challenge_id', challengeId).maybeSingle()
  if (matchError) throw matchError
  if (!match || typeof match.match_pin !== 'string' || !/^\d{4}$/.test(match.match_pin)
    || match.ended_early_at || match.result_finalized_at || match.official_result_id) {
    throw new Error('Platný PIN výzvy nie je dostupný.')
  }
  const { data: profiles, error: profilesError } = await admin.from('proffiles')
    .select('id, email, preferred_language').in('id', jobs.map(job => job.recipient_profile_id))
  if (profilesError) throw profilesError
  let failed = 0
  let sent = 0
  for (const [index, job] of jobs.entries()) {
    if (profileId && job.index) await delay(job.index * 650)
    else if (!profileId && index) await delay(650)
    const profile = profiles?.find(item => String(item.id) === String(job.recipient_profile_id))
    try {
      if (!profile || typeof profile.email !== 'string' || !profile.email.trim() || !isAppLanguage(profile.preferred_language)) {
        throw new Error('Účastník nemá platný e-mail alebo jazyk.')
      }
      await sendChallengePinEmail({ id: String(job.id), recipient: profile.email, pin: match.match_pin }, profile.preferred_language, apiKey, from)
      const { error } = await admin.from('challenge_pin_emails').update({ sent_at: new Date().toISOString() }).eq('id', job.id).is('sent_at', null)
      if (error) throw error
      sent++
    } catch (error) {
      failed++
      console.error('Odoslanie PIN-u výzvy zlyhalo:', error)
    }
  }
  if (failed) throw new Error(`PIN sa nepodarilo odoslať ${failed} účastníkom. Skús odoslanie znova.`)
  return { sent }
}
