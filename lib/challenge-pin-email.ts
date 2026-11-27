import { Resend } from 'resend'
import type { AppLanguage } from './countries'

export async function sendChallengePinEmail(job: { id: string; recipient: string; pin: string }, language: AppLanguage, apiKey: string, from: string) {
  const copy = language === 'nl'
    ? { subject: 'RIVA Padel – wedstrijd bevestigd', text: 'Alle spelers hebben de uitdaging bevestigd. Gebruik deze PIN op de tablet om de wedstrijd te starten. Deel de PIN niet met anderen.' }
    : language === 'en'
      ? { subject: 'RIVA Padel – match confirmed', text: 'All players have confirmed the challenge. Enter this PIN on the tablet to start the match. Do not share the PIN with others.' }
      : { subject: 'RIVA Padel – potvrdená výzva', text: 'Všetci hráči potvrdili výzvu. Tento PIN zadajte na tablete pri začatí zápasu. Nezdieľajte ho s inými osobami.' }
  const { data, error } = await new Resend(apiKey).emails.send({
    from, to: [job.recipient], subject: copy.subject, text: `${copy.text}\n\nPIN: ${job.pin}`,
  }, { idempotencyKey: `challenge-pin-${job.id}` })
  if (error) throw new Error(`Odoslanie PIN e-mailu zlyhalo (${error.name}): ${error.message}`)
  if (!data?.id) throw new Error('E-mailová služba nepotvrdila prijatie správy.')
}
