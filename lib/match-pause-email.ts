import { Resend } from 'resend'
import type { AppLanguage } from './countries'

export type PauseEmail = { email_id: string; recipient: string; pin: string }

export async function sendPauseEmail(job: PauseEmail, apiKey: string, from: string, language: AppLanguage = 'sk') {
  const resend = new Resend(apiKey)
  const localized = language === 'nl' ? {
    subject: 'RIVA Padel – wedstrijd onderbroken',
    heading: 'De wedstrijd is onderbroken',
    saved: 'De score, regels, service en het volledige geregistreerde wedstrijdverloop zijn opgeslagen.',
    pin: 'Je pincode om verder te spelen:',
    action: 'Voer pincode in',
    instruction: 'Voer deze pincode op de tablet in. De opgeslagen wedstrijd wordt automatisch hervat.',
    safety: 'Dezelfde pincode blijft geldig na hervatten en opnieuw onderbreken, totdat de wedstrijd is afgelopen. Alle deelnemers gebruiken dezelfde code. Deel deze niet met anderen.',
    ranking: 'Een onderbroken wedstrijd is nog niet afgelopen en telt nog niet mee voor de competitie of ELO.',
  } : language === 'en' ? {
    subject: 'RIVA Padel – match paused',
    heading: 'The match has been paused',
    saved: 'The score, rules, service and complete recorded match history have been saved.',
    pin: 'Your PIN to resume:',
    action: 'Enter PIN',
    instruction: 'Enter this PIN on the tablet. The saved match resumes automatically.',
    safety: 'The same PIN remains valid after resuming and pausing again, until the match ends. All participants share it. Do not share it with anyone else.',
    ranking: 'A paused match has not finished and does not count towards the league or ELO yet.',
  } : null
  const localizedText = localized ? `${localized.saved}\n\n${localized.pin} ${job.pin}\n\n${localized.action}. ${localized.instruction}\n\n${localized.safety}\n\n${localized.ranking}` : null
  const localizedHtml = localized ? `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#f5f7f6;color:#061016">
    <h1>RIVA Padel</h1><h2>${localized.heading}</h2><p>${localized.saved}</p><p>${localized.pin}</p>
    <div style="padding:24px;text-align:center;background:#a8e63c;border-radius:12px;font-size:48px;font-weight:bold;letter-spacing:10px">${job.pin}</div>
    <p><strong>${localized.action}</strong>. ${localized.instruction}</p><p>${localized.safety}</p><p>${localized.ranking}</p></div>` : null
  const { data, error } = await resend.emails.send({
      from,
      to: [job.recipient],
      subject: localized?.subject ?? 'RIVA Padel – prerušený zápas',
      text: localizedText ?? `Váš zápas bol prerušený. Celé skóre, pravidlá a priebeh bod po bode sú uložené.\n\nPIN na pokračovanie: ${job.pin}\n\nNa tablete vyberte „Zadaj PIN kód“ a zadajte tento PIN. Uložený zápas sa automaticky obnoví. Rovnaký PIN platí aj po obnovení a ďalšom prerušení, až do ukončenia zápasu. Je spoločný pre všetkých účastníkov. Nezdieľajte ho s inými osobami.\n\nPo prerušení sa výsledok ešte nezapočítava do ligy ani ELO.`,
      html: localizedHtml ?? `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#f5f7f6;color:#061016">
        <h1>RIVA Padel</h1><h2>Zápas bol prerušený</h2>
        <p>Skóre, pravidlá, podanie a celý zaznamenaný priebeh zápasu sú uložené.</p>
        <p>Váš PIN na pokračovanie:</p>
        <div style="padding:24px;text-align:center;background:#a8e63c;border-radius:12px;font-size:48px;font-weight:bold;letter-spacing:10px">${job.pin}</div>
        <p>Na tablete vyberte <strong>Zadaj PIN kód</strong> a zadajte tento kód. Uložený zápas sa automaticky obnoví.</p>
        <p>Rovnaký PIN platí aj po obnovení a ďalšom prerušení, až do ukončenia zápasu. Je spoločný pre všetkých účastníkov. Nezdieľajte ho s inými osobami.</p>
        <p>Prerušený zápas ešte nie je ukončený a nezapočítava sa do ELO.</p>
      </div>`,
    }, {
      idempotencyKey: `match-pause-${job.email_id}`,
  })
  if (error) throw new Error(`Odoslanie e-mailu zlyhalo (${error.name}): ${error.message}`)
  if (!data?.id) {
    throw new Error('E-mailová služba nepotvrdila prijatie správy.')
  }
}
