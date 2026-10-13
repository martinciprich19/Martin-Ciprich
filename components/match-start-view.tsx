'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Keyboard, LoaderCircle, ScanQrCode, Zap } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { MatchView } from '@/components/match-view'
import { ScoringModeDialog } from '@/components/scoring-mode-dialog'
import type { ScoringType } from '@/lib/live-match-scoring'
import { RivaQrScanner } from '@/components/riva-qr-scanner'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'

export function MatchStartView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const matchId = searchParams.get('id')
  const { t } = useLanguage()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const creatingRef = useRef(false)
  const [choosingRules, setChoosingRules] = useState(false)

  async function startQuickGame(scoringType: ScoringType) {
    if (creatingRef.current) return
    creatingRef.current = true
    setIsCreating(true)
    setError('')
    try {
      const { data, error: insertError } = await createClient()
        .from('live_matches')
        .insert({
          challenge_id: null,
          scoring_type: scoringType,
          match_pin: null,
          is_pin_activated: false,
          team_a_player1_name: 'Hráč 1',
          team_a_player2_name: 'Hráč 2',
          team_b_player1_name: 'Hráč 1',
          team_b_player2_name: 'Hráč 2',
          team_a_game_score: 0,
          team_b_game_score: 0,
          serving_team: Math.random() < 0.5 ? 'TEAM_A' : 'TEAM_B',
          initial_server_chosen: true,
        })
        .select('id')
        .single()
      if (insertError) throw insertError
      if (!data || typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) {
        throw new Error(t('Databáza nevrátila platný zápas.', 'The database did not return a valid match.'))
      }
      router.push(`/match?id=${encodeURIComponent(data.id)}`)
    } catch (createError: unknown) {
      console.error('Vytvorenie rýchlej hry zlyhalo:', createError)
      setError(getErrorMessage(createError, t('Rýchlu hru sa nepodarilo vytvoriť. Skús to znova.', 'Could not create a quick game. Please try again.')))
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }

  if (matchId !== null) return <MatchView key={matchId} matchId={matchId} />
  if (isScanning) return <RivaQrScanner onClose={() => setIsScanning(false)} />

  const cardClass = 'group flex min-h-80 flex-col items-start rounded-3xl border bg-[#0b1b22]/95 p-7 text-left shadow-xl transition duration-200 motion-safe:hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a8e63c] sm:p-8'

  return (
    <section className="mx-auto max-w-[1120px] py-6">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#a8e63c]">RIVA / PLAY TOGETHER</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">{t('Začni svoj zápas', 'Start your match')}</h1>
        <p className="mt-4 text-sm leading-6 text-white/55 sm:text-base">{t('Vyber si spôsob hry a poď na kurt.', 'Choose how to play and head to the court.')}</p>
      </header>

      {error ? <p role="alert" className="mt-6 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-center text-sm text-red-200">{error}</p> : null}

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <button type="button" onClick={() => { setError(''); setChoosingRules(true) }} disabled={isCreating} aria-busy={isCreating} className={`${cardClass} border-[#a8e63c]/25 hover:border-[#a8e63c]/70 hover:shadow-[0_16px_45px_rgba(168,230,60,0.12)] disabled:cursor-wait disabled:opacity-60`}>
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#a8e63c]/10 text-[#c1fa66]">{isCreating ? <LoaderCircle size={38} className="animate-spin" aria-hidden="true" /> : <Zap size={38} aria-hidden="true" />}</span>
          <span className="mt-6 text-2xl font-black">{t('Rýchla hra', 'Quick game')}</span>
          <span className="mt-3 text-sm leading-6 text-white/55">{t('Tréning alebo neoficiálny zápas. Začni ihneď bez PIN-u a bez vplyvu na ligové ELO.', 'Practice or play a friendly match. Start without a PIN or any effect on league ELO.')}</span>
          <span className="mt-auto flex items-center gap-2 pt-6 text-sm font-bold text-[#c1fa66]">{isCreating ? t('Vytváram zápas…', 'Creating match…') : t('Poďme hrať', "Let's play")}<ArrowRight size={18} aria-hidden="true" className="transition-transform group-hover:translate-x-1" /></span>
        </button>

        <Link href="/kiosk" className={`${cardClass} border-sky-300/20 hover:border-sky-300/60 hover:shadow-[0_16px_45px_rgba(125,211,252,0.1)]`}>
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-300/10 text-sky-200"><Keyboard size={38} aria-hidden="true" /></span>
          <span className="mt-6 text-2xl font-black">{t('Zadaj PIN kód', 'Enter PIN code')}</span>
          <span className="mt-3 text-sm leading-6 text-white/55">{t('Oficiálny ligový zápas. Zadaj 4-miestny PIN z potvrdenej výzvy na kiosku pri kurte.', 'Official league match. Enter the four-digit PIN from your confirmed challenge.')}</span>
          <span className="mt-auto flex items-center gap-2 pt-6 text-sm font-bold text-sky-200">{t('Otvoriť kiosk', 'Open kiosk')}<ArrowRight size={18} aria-hidden="true" className="transition-transform group-hover:translate-x-1" /></span>
        </Link>

        <button type="button" onClick={() => setIsScanning(true)} className={`${cardClass} border-violet-300/20 hover:border-violet-300/60 hover:shadow-[0_16px_45px_rgba(196,181,253,0.1)]`}>
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-violet-300/10 text-violet-200"><ScanQrCode size={38} aria-hidden="true" /></span>
          <span className="mt-6 text-2xl font-black">{t('QR ligový zápas', 'QR league match')}</span>
          <span className="mt-3 text-sm leading-6 text-white/55">{t('Naskenuj štyroch hráčov do dvoch tímov. Po zápase všetci potvrdia výsledok vo svojom profile a započíta sa ELO.', 'Scan four players into two teams. After the match everyone approves the result in their profile to apply ELO.')}</span>
          <span className="mt-auto flex items-center gap-2 pt-6 text-sm font-bold text-violet-200">{t('Spustiť skener', 'Start scanner')}<ArrowRight size={18} aria-hidden="true" className="transition-transform group-hover:translate-x-1" /></span>
        </button>
      </div>
      {choosingRules ? <ScoringModeDialog busy={isCreating} error={error} onCancel={() => setChoosingRules(false)} onConfirm={(mode) => void startQuickGame(mode)} /> : null}
    </section>
  )
}
