'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Delete, LoaderCircle, LockKeyhole } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ScoringModeDialog } from '@/components/scoring-mode-dialog'
import type { MatchSettings } from '@/lib/live-match-scoring'
import { getErrorMessage } from '@/lib/errors'
import { useRouter, useSearchParams } from 'next/navigation'
import { useKioskInactivity } from '@/lib/use-kiosk-inactivity'
import { createQrDeviceToken, saveQrDeviceToken } from '@/lib/qr-match-device'

const PIN_LENGTH = 4

export function KioskView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedCourtId = searchParams.get('courtId')
  const courtId = requestedCourtId && /^[1-9]\d*$/.test(requestedCourtId) && Number.isSafeInteger(Number(requestedCourtId))
    ? Number(requestedCourtId)
    : null
  const [resuming, setResuming] = useState(false)
  const [pin, setPin] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState('')
  const isVerifyingRef = useRef(false)
  const inactivityResetRef = useRef(false)
  const [choosingRules, setChoosingRules] = useState(false)

  const resetKiosk = useCallback(() => {
    inactivityResetRef.current = true
    setPin('')
    setChoosingRules(false)
    setError('')
    router.replace(courtId === null ? '/match?mode=kiosk' : `/kiosk?courtId=${courtId}`)
  }, [courtId, router])

  useKioskInactivity(true, resetKiosk)

  const verifyPin = useCallback(async (value: string) => {
    if (!/^\d{4}$/.test(value) || isVerifyingRef.current) return
    if (!resuming) { setChoosingRules(true); return }
    isVerifyingRef.current = true
    inactivityResetRef.current = false
    setIsVerifying(true)
    setError('')
    try {
      const pendingKey = `riva-pending-resume-${value}`
      const token = window.sessionStorage.getItem(pendingKey) ?? createQrDeviceToken()
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Uložený kľúč pokračovania je poškodený.')
      window.sessionStorage.setItem(pendingKey, token)
      const response = await fetch('/api/match-resume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: value, deviceToken: token }),
        signal: AbortSignal.timeout(20_000),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Zápas sa nepodarilo obnoviť.')
      if (typeof result.matchId !== 'string') throw new Error('Chýba ID obnoveného zápasu.')
      saveQrDeviceToken(result.matchId, token)
      window.sessionStorage.removeItem(pendingKey)
      if (inactivityResetRef.current) return
      const courtQuery = courtId === null ? '' : `&courtId=${encodeURIComponent(String(courtId))}`
      window.location.assign(`/match?id=${encodeURIComponent(result.matchId)}&mode=kiosk${courtQuery}`)
    } catch (error) {
      console.error('Obnovenie zápasu pomocou PIN-u zlyhalo:', error)
      setPin('')
      setError(getErrorMessage(error, 'Zápas sa nepodarilo obnoviť.'))
    } finally {
      isVerifyingRef.current = false
      setIsVerifying(false)
    }
  }, [courtId, resuming])

  const activatePin = useCallback(async (value: string, settings: MatchSettings) => {
    if (!/^\d{4}$/.test(value) || isVerifyingRef.current) return
    inactivityResetRef.current = false
    isVerifyingRef.current = true
    setIsVerifying(true)
    setError('')
    try {
      const { data, error: rpcError } = courtId === null
        ? await createClient().rpc('activate_live_match_pin_with_settings', {
          p_match_pin: value,
          p_scoring_type: settings.scoring_type,
          p_set_format: settings.set_format,
          p_third_set_format: settings.third_set_format,
        })
        : await createClient().rpc('activate_live_match_pin_for_court', {
          p_match_pin: value,
          p_scoring_type: settings.scoring_type,
          p_set_format: settings.set_format,
          p_third_set_format: settings.third_set_format,
          p_court_id: courtId,
        })
      if (rpcError?.code === 'PGRST202') {
        throw new Error(courtId === null
          ? 'V Supabase spusti SQL migráciu 057 pre nastavenia zápasu.'
          : 'V Supabase spusti SQL migráciu 072 pre obrazovky kurtov.')
      }
      if (rpcError) throw rpcError
      if (typeof data !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
        throw new Error('Overenie nevrátilo platný zápas.')
      }
      if (inactivityResetRef.current) return
      const courtQuery = courtId === null ? '' : `&courtId=${encodeURIComponent(String(courtId))}`
      window.location.assign(`/match?id=${encodeURIComponent(data)}&mode=kiosk${courtQuery}`)
    } catch (verifyError: unknown) {
      console.error('Overenie PIN-u kiosku zlyhalo:', verifyError)
      setPin('')
      setChoosingRules(false)
      setError(getErrorMessage(verifyError, 'PIN nie je platný alebo už bol použitý. Skontroluj kód a skús to znova.'))
    } finally {
      isVerifyingRef.current = false
      setIsVerifying(false)
    }
  }, [courtId])

  const appendDigit = useCallback((digit: string) => {
    if (isVerifyingRef.current) return
    setError('')
    setPin((current) => current.length >= PIN_LENGTH ? current : `${current}${digit}`)
  }, [])

  useEffect(() => {
    if (pin.length === PIN_LENGTH) void verifyPin(pin)
  }, [pin, verifyPin])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (choosingRules) return
      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        appendDigit(event.key)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        setError('')
        setPin((current) => current.slice(0, -1))
      } else if (event.key === 'Escape') {
        setError('')
        setPin('')
      } else if (event.key === 'Enter') {
        void verifyPin(pin)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [appendDigit, pin, verifyPin, choosingRules])

  return (
    <main className="relative isolate flex min-h-[100svh] items-center justify-center overflow-hidden bg-app-ink px-4 py-8 text-app-fg">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(168,230,60,0.12),transparent_55%)]" />
      <section aria-labelledby="kiosk-heading" className="w-full max-w-md rounded-[2rem] border border-app-line/10 bg-app-court/95 p-6 shadow-2xl backdrop-blur sm:p-9">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#a8e63c]/20 bg-[#a8e63c]/10 text-app-highlight">
          <LockKeyhole size={26} aria-hidden="true" />
        </div>
        <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-[0.24em] text-app-accent">RIVA PADEL / KIOSK</p>
        <h1 id="kiosk-heading" className="mt-2 text-center text-3xl font-black tracking-tight">{resuming ? 'Pokračovať v zápase' : 'Začni svoj zápas'}</h1>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" disabled={isVerifying || choosingRules} aria-pressed={!resuming} onClick={() => { setResuming(false); setPin(''); setError('') }} className={`min-h-12 rounded-xl border p-2 text-sm ${!resuming ? 'border-[#a8e63c] text-app-accent' : 'border-app-line/15'}`}>Nová výzva</button>
          <button type="button" disabled={isVerifying || choosingRules} aria-pressed={resuming} onClick={() => { setResuming(true); setPin(''); setError('') }} className={`min-h-12 rounded-xl border p-2 text-sm ${resuming ? 'border-[#a8e63c] text-app-accent' : 'border-app-line/15'}`}>Pokračovať v zápase</button>
        </div>
        <p className="mt-2 text-center text-sm text-app-fg/50">{resuming ? 'Zadaj 4-miestny PIN uloženého zápasu. Pravidlá aj skóre zostanú zachované.' : 'Zadaj 4-miestny PIN z hráčskej výzvy.'}</p>

        <div className="mt-8 flex justify-center gap-4" aria-label={`${pin.length} zo 4 číslic zadaných`}>
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <span key={index} className={`flex h-14 w-14 items-center justify-center rounded-xl border text-2xl font-black sm:h-16 sm:w-16 ${pin[index] ? 'border-[#a8e63c]/50 bg-[#a8e63c]/10 text-app-highlight' : 'border-app-line/10 bg-app-overlay/[0.03] text-transparent'}`}>
              {pin[index] ? '●' : '0'}
            </span>
          ))}
        </div>

        {error ? <p role="alert" className="mt-4 text-center text-sm font-semibold text-app-red-300">{error}</p> : null}
        {isVerifying ? <p role="status" className="mt-4 flex items-center justify-center gap-2 text-sm text-app-fg/65"><LoaderCircle size={16} className="animate-spin" /> Overujem PIN…</p> : null}

        <div className="mx-auto mt-7 grid max-w-xs grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button key={digit} type="button" onClick={() => appendDigit(digit)} disabled={isVerifying || pin.length >= PIN_LENGTH} className="min-h-16 rounded-2xl border border-app-line/10 bg-app-overlay/[0.04] text-2xl font-bold transition hover:border-[#a8e63c]/40 hover:bg-[#a8e63c]/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">{digit}</button>
          ))}
          <button type="button" onClick={() => { setPin(''); setError('') }} disabled={isVerifying || !pin} aria-label="Vymazať PIN" className="min-h-16 rounded-2xl border border-app-line/10 bg-app-overlay/[0.04] text-xs font-bold text-app-fg/55 transition hover:bg-app-overlay/10 disabled:cursor-not-allowed disabled:opacity-30">ZMAZAŤ</button>
          <button type="button" onClick={() => appendDigit('0')} disabled={isVerifying || pin.length >= PIN_LENGTH} className="min-h-16 rounded-2xl border border-app-line/10 bg-app-overlay/[0.04] text-2xl font-bold transition hover:border-[#a8e63c]/40 hover:bg-[#a8e63c]/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">0</button>
          <button type="button" onClick={() => { setPin((current) => current.slice(0, -1)); setError('') }} disabled={isVerifying || !pin} aria-label="Odstrániť poslednú číslicu" className="flex min-h-16 items-center justify-center rounded-2xl border border-app-line/10 bg-app-overlay/[0.04] text-app-fg/65 transition hover:bg-app-overlay/10 disabled:cursor-not-allowed disabled:opacity-30"><Delete size={22} aria-hidden="true" /></button>
        </div>
        <p className="mt-6 text-center text-xs text-app-fg/30">PIN môžeš zadávať aj pomocou klávesnice tabletu.</p>
      </section>
      {choosingRules ? <ScoringModeDialog busy={isVerifying} error={error} onCancel={() => { setChoosingRules(false); setPin('') }} onConfirm={(mode) => void activatePin(pin, mode)} /> : null}
    </main>
  )
}
