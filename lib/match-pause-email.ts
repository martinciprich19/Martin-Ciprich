import { Resend } from 'resend'

export type PauseEmail = { email_id: string; recipient: string; pin: string }

export async function sendPauseEmail(job: PauseEmail, apiKey: string, from: string) {
  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
      from,
      to: [job.recipient],
      subject: 'RIVA Padel – prerušený zápas',
      text: `Váš zápas bol prerušený. Celé skóre, pravidlá a priebeh bod po bode sú uložené.\n\nPIN na pokračovanie: ${job.pin}\n\nNa tablete vyberte „Zadaj PIN kód“, potom „Pokračovať v zápase“ a zadajte tento PIN. Rovnaký PIN platí aj po obnovení a ďalšom prerušení, až do ukončenia zápasu. Je spoločný pre všetkých účastníkov. Nezdieľajte ho s inými osobami.\n\nPo prerušení sa výsledok ešte nezapočítava do ligy ani ELO.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#f5f7f6;color:#061016">
        <h1>RIVA Padel</h1><h2>Zápas bol prerušený</h2>
        <p>Skóre, pravidlá, podanie a celý zaznamenaný priebeh zápasu sú uložené.</p>
        <p>Váš PIN na pokračovanie:</p>
        <div style="padding:24px;text-align:center;background:#a8e63c;border-radius:12px;font-size:48px;font-weight:bold;letter-spacing:10px">${job.pin}</div>
        <p>Na tablete vyberte <strong>Zadaj PIN kód → Pokračovať v zápase</strong> a zadajte tento kód.</p>
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
