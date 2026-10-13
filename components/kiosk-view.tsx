'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Delete, LoaderCircle, LockKeyhole } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const PIN_LENGTH = 4

export function KioskView() {
  const [pin, setPin] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState('')
  const isVerifyingRef = useRef(false)

  const verifyPin = useCallback(async (value: string) => {
    if (!/^\d{4}$/.test(value) || isVerifyingRef.current) return
    isVerifyingRef.current = true
    setIsVerifying(true)
    setError('')
    try {
      const { data, error: rpcError } = await createClient().rpc('activate_live_match_pin', {
        p_match_pin: value,
      })
      if (rpcError) throw rpcError
      if (typeof data !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
        throw new Error('Overenie nevrátilo platný zápas.')
      }
      window.location.assign(`/match?id=${encodeURIComponent(data)}`)
    } catch (verifyError: unknown) {
      console.error('Overenie PIN-u kiosku zlyhalo:', verifyError)
      setPin('')
      setError('PIN nie je platný alebo už bol použitý. Skontroluj kód a skús to znova.')
    } finally {
      isVerifyingRef.current = false
      setIsVerifying(false)
    }
  }, [])

  const appendDigit = useCallback((digit: string) => {
    if (isVerifyingRef.current) return
    setError('')
    setPin((current) => current.length >= PIN_LENGTH ? current : `${current}${digit}`)
    if (pin.length === PIN_LENGTH - 1) void verifyPin(`${pin}${digit}`)
  }, [pin, verifyPin])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
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
  }, [appendDigit, pin, verifyPin])

  return (
    <main className="relative isolate flex min-h-[100svh] items-center justify-center overflow-hidden bg-[#061016] px-4 py-8 text-white">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(168,230,60,0.12),transparent_55%)]" />
      <section aria-labelledby="kiosk-heading" className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0b1b22]/95 p-6 shadow-2xl backdrop-blur sm:p-9">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#a8e63c]/20 bg-[#a8e63c]/10 text-[#c1fa66]">
          <LockKeyhole size={26} aria-hidden="true" />
        </div>
        <p className="mt-6 text-center text-[10px] font-bold uppercase tracking-[0.24em] text-[#a8e63c]">RIVA PADEL / KIOSK</p>
        <h1 id="kiosk-heading" className="mt-2 text-center text-3xl font-black tracking-tight">Začni svoj zápas</h1>
        <p className="mt-2 text-center text-sm text-white/50">Zadaj 4-miestny PIN z hráčskej výzvy.</p>

        <div className="mt-8 flex justify-center gap-4" aria-label={`${pin.length} zo 4 číslic zadaných`}>
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <span key={index} className={`flex h-14 w-14 items-center justify-center rounded-xl border text-2xl font-black sm:h-16 sm:w-16 ${pin[index] ? 'border-[#a8e63c]/50 bg-[#a8e63c]/10 text-[#c1fa66]' : 'border-white/10 bg-white/[0.03] text-transparent'}`}>
              {pin[index] ? '●' : '0'}
            </span>
          ))}
        </div>

        {error ? <p role="alert" className="mt-4 text-center text-sm font-semibold text-red-300">{error}</p> : null}
        {isVerifying ? <p role="status" className="mt-4 flex items-center justify-center gap-2 text-sm text-white/65"><LoaderCircle size={16} className="animate-spin" /> Overujem PIN…</p> : null}

        <div className="mx-auto mt-7 grid max-w-xs grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button key={digit} type="button" onClick={() => appendDigit(digit)} disabled={isVerifying || pin.length >= PIN_LENGTH} className="min-h-16 rounded-2xl border border-white/10 bg-white/[0.04] text-2xl font-bold transition hover:border-[#a8e63c]/40 hover:bg-[#a8e63c]/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">{digit}</button>
          ))}
          <button type="button" onClick={() => { setPin(''); setError('') }} disabled={isVerifying || !pin} aria-label="Vymazať PIN" className="min-h-16 rounded-2xl border border-white/10 bg-white/[0.04] text-xs font-bold text-white/55 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30">ZMAZAŤ</button>
          <button type="button" onClick={() => appendDigit('0')} disabled={isVerifying || pin.length >= PIN_LENGTH} className="min-h-16 rounded-2xl border border-white/10 bg-white/[0.04] text-2xl font-bold transition hover:border-[#a8e63c]/40 hover:bg-[#a8e63c]/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40">0</button>
          <button type="button" onClick={() => { setPin((current) => current.slice(0, -1)); setError('') }} disabled={isVerifying || !pin} aria-label="Odstrániť poslednú číslicu" className="flex min-h-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/65 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"><Delete size={22} aria-hidden="true" /></button>
        </div>
        <p className="mt-6 text-center text-xs text-white/30">PIN môžeš zadávať aj pomocou klávesnice tabletu.</p>
      </section>
    </main>
  )
}
