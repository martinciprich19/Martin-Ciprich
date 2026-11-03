'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Keyboard, LoaderCircle, ScanQrCode, Zap } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { useLeague } from '@/components/league-provider'
import { MatchView } from '@/components/match-view'
import { ScoringModeDialog } from '@/components/scoring-mode-dialog'
import type { MatchSettings } from '@/lib/live-match-scoring'
import { RivaQrScanner } from '@/components/riva-qr-scanner'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useKioskInactivity } from '@/lib/use-kiosk-inactivity'

export function MatchStartView({ kioskMode = false }: { kioskMode?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const matchId = searchParams.get('id')
  const requestedCourtId = searchParams.get('courtId')
  const courtId = requestedCourtId && /^[1-9]\d*$/.test(requestedCourtId) && Number.isSafeInteger(Number(requestedCourtId))
    ? requestedCourtId
    : null
  const viewerMode = searchParams.get('view') === 'viewer'
  const { t } = useLanguage()
  const { country, isLoading: leagueLoading } = useLeague()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const creatingRef = useRef(false)
  const inactivityResetRef = useRef(false)
  const [choosingRules, setChoosingRules] = useState(false)
  const [nicknames, setNicknames] = useState(['', '', '', ''])

  const resetKioskFlow = useCallback(() => {
    inactivityResetRef.current = true
    setIsScanning(false)
    setChoosingRules(false)
    setNicknames(['', '', '', ''])
    setError('')
    router.replace(kioskMode ? '/match?mode=kiosk' : '/match')
  }, [kioskMode, router])

  useKioskInactivity(matchId === null && (isScanning || choosingRules || isCreating), resetKioskFlow)

  async function startQuickGame(settings: MatchSettings) {
    if (creatingRef.current || leagueLoading) return
    inactivityResetRef.current = false
    creatingRef.current = true
    setIsCreating(true)
    setError('')
    try {
      const { data, error: insertError } = await createClient()
        .from('live_matches')
        .insert({
          challenge_id: null,
          country_code: country,
          ...settings,
          match_pin: null,
          is_pin_activated: false,
          team_a_player1_name: nicknames[0].trim() || 'Hráč 1',
          team_a_player2_name: nicknames[1].trim() || 'Hráč 2',
          team_b_player1_name: nicknames[2].trim() || 'Hráč 1',
          team_b_player2_name: nicknames[3].trim() || 'Hráč 2',
          team_a_game_score: 0,
          team_b_game_score: 0,
          serving_team: null,
          initial_server_chosen: false,
        })
        .select('id')
        .single()
      if (insertError) throw insertError
      if (!data || typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) {
        throw new Error(t('Databáza nevrátila platný zápas.', 'The database did not return a valid match.'))
      }
      if (inactivityResetRef.current) return
      router.push(`/match?id=${encodeURIComponent(data.id)}${kioskMode ? '&mode=kiosk' : ''}`)
    } catch (createError: unknown) {
      console.error('Vytvorenie rýchlej hry zlyhalo:', createError)
      setError(getErrorMessage(createError, t('Rýchlu hru sa nepodarilo vytvoriť. Skús to znova.', 'Could not create a quick game. Please try again.')))
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }

  if (matchId !== null) return <MatchView key={matchId} matchId={matchId} kioskMode={kioskMode} viewerMode={viewerMode} courtId={courtId} />
  if (isScanning) return <RivaQrScanner key={country} kioskMode={kioskMode} onClose={() => setIsScanning(false)} />

  const cardClass = 'group flex min-h-80 flex-col items-start rounded-3xl border bg-app-court/95 p-7 text-left shadow-xl transition duration-200 motion-safe:hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a8e63c] sm:p-8'

  return (
    <section className="mx-auto max-w-[1120px] py-6">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-app-accent">RIVA / PLAY TOGETHER</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">{t('Začni svoj zápas', 'Start your match')}</h1>
        <p className="mt-4 text-sm leading-6 text-app-fg/55 sm:text-base">{t('Vyber si spôsob hry a poď na kurt.', 'Choose how to play and head to the court.')}</p>
      </header>

      {error ? <p role="alert" className="mt-6 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-center text-sm text-app-red-200">{error}</p> : null}

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <button type="button" onClick={() => { inactivityResetRef.current = false; setError(''); setChoosingRules(true) }} disabled={isCreating || leagueLoading} aria-busy={isCreating} className={`${cardClass} border-[#a8e63c]/25 hover:border-[#a8e63c]/70 hover:shadow-[0_16px_45px_rgba(168,230,60,0.12)] disabled:cursor-wait disabled:opacity-60`}>
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#a8e63c]/10 text-app-highlight">{isCreating ? <LoaderCircle size={38} className="animate-spin" aria-hidden="true" /> : <Zap size={38} aria-hidden="true" />}</span>
          <span className="mt-6 text-2xl font-black">{t('Rýchla hra', 'Quick game')}</span>
          <span className="mt-3 text-sm leading-6 text-app-fg/55">{t('Tréning alebo neoficiálny zápas. Začni ihneď bez PIN-u a bez vplyvu na ligové ELO.', 'Practice or play a friendly match. Start without a PIN or any effect on league ELO.')}</span>
          <span className="mt-auto flex items-center gap-2 pt-6 text-sm font-bold text-app-highlight">{isCreating ? t('Vytváram zápas…', 'Creating match…') : t('Poďme hrať', "Let's play")}<ArrowRight size={18} aria-hidden="true" className="transition-transform group-hover:translate-x-1" /></span>
        </button>

        <Link href="/kiosk" className={`${cardClass} border-sky-300/20 hover:border-sky-300/60 hover:shadow-[0_16px_45px_rgba(125,211,252,0.1)]`}>
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-300/10 text-app-sky-200"><Keyboard size={38} aria-hidden="true" /></span>
          <span className="mt-6 text-2xl font-black">{t('Zadaj PIN kód', 'Enter PIN code')}</span>
          <span className="mt-3 text-sm leading-6 text-app-fg/55">{t('Zadaj 4-miestny PIN z potvrdenej výzvy alebo pokračuj v uloženom prerušenom zápase.', 'Enter the four-digit PIN from a confirmed challenge or resume a saved paused match.')}</span>
          <span className="mt-auto flex items-center gap-2 pt-6 text-sm font-bold text-app-sky-200">{t('Otvoriť kiosk', 'Open kiosk')}<ArrowRight size={18} aria-hidden="true" className="transition-transform group-hover:translate-x-1" /></span>
        </Link>

        <button type="button" onClick={() => { inactivityResetRef.current = false; setIsScanning(true) }} className={`${cardClass} border-violet-300/20 hover:border-violet-300/60 hover:shadow-[0_16px_45px_rgba(196,181,253,0.1)]`}>
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-violet-300/10 text-app-violet-200"><ScanQrCode size={38} aria-hidden="true" /></span>
          <span className="mt-6 text-2xl font-black">{t('QR ligový zápas', 'QR league match')}</span>
          <span className="mt-3 text-sm leading-6 text-app-fg/55">{t('Naskenuj štyroch hráčov do dvoch tímov. Výsledok a ELO sa uložia pri ukončení zápasu alebo spustení ďalšieho, bez potvrdení hráčov.', 'Scan four players into two teams. The result and ELO are saved when ending the match or starting the next one, without player confirmations.')}</span>
          <span className="mt-auto flex items-center gap-2 pt-6 text-sm font-bold text-app-violet-200">{t('Spustiť skener', 'Start scanner')}<ArrowRight size={18} aria-hidden="true" className="transition-transform group-hover:translate-x-1" /></span>
        </button>
      </div>
      {choosingRules ? <ScoringModeDialog busy={isCreating} error={error} onCancel={() => { setChoosingRules(false); setNicknames(['', '', '', '']) }} onConfirm={(mode) => void startQuickGame(mode)}>
        <fieldset disabled={isCreating} className="mt-4">
          <legend className="text-sm font-bold">{t('Prezývky hráčov', 'Player nicknames')} <span className="font-normal text-app-fg/45">({t('voliteľné', 'optional')})</span></legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {[0, 1].map((team) => <div key={team} className="min-w-0 space-y-2">
              <p className="text-xs font-bold text-app-accent">{t('Dvojica', 'Team')} {team + 1}</p>
              {[0, 1].map((player) => {
                const slot = team * 2 + player
                return <label key={slot} className="block">
                  <span className="mb-1 block text-xs text-app-fg/60">{t('Hráč', 'Player')} {player + 1}</span>
                  <input type="text" value={nicknames[slot]} maxLength={40} autoComplete="off"
                    placeholder={t('Prezývka', 'Nickname')}
                    onChange={(event) => setNicknames((current) => current.map((name, index) => index === slot ? event.target.value : name))}
                    className="min-h-11 w-full min-w-0 rounded-lg border border-app-line/15 bg-app-overlay/5 px-3 text-sm outline-none focus:border-[#a8e63c] disabled:opacity-40" />
                </label>
              })}
            </div>)}
          </div>
          <p className="mt-2 text-xs text-app-fg/45">{t('Prázdne polia ponechajú predvolené mená hráčov.', 'Leave fields empty to use the default player names.')}</p>
        </fieldset>
      </ScoringModeDialog> : null}
    </section>
  )
}
