'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Camera, Check, ChevronDown, MapPin, ScanQrCode } from 'lucide-react'
import type QrScanner from 'qr-scanner'
import { useLanguage } from '@/components/language-provider'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import { getRivaProfilePath } from '@/lib/riva-qr'
import { fetchArenas } from '@/lib/arenas'
import { filterArenas } from '@/lib/arena-search'
import useSWR from 'swr'
import { createQrDeviceToken, saveQrDeviceToken } from '@/lib/qr-match-device'
import { getQrScanRegion, QR_VIEWFINDER_RATIO } from '@/lib/qr-scan-region'

type ScannedPlayer = { id: string; name: string }
const slots = [
  { team: 1, player: 1 },
  { team: 1, player: 2 },
  { team: 2, player: 1 },
  { team: 2, player: 2 },
] as const

export function RivaQrScanner({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { t } = useLanguage()
  const tRef = useRef(t)
  tRef.current = t
  const videoRef = useRef<HTMLVideoElement>(null)
  const viewfinderRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const playersRef = useRef<ScannedPlayer[]>([])
  const processingRef = useRef(false)
  const creationRef = useRef(false)
  const liveMatchIdRef = useRef<string | null>(null)
  const deviceTokenRef = useRef<string | null>(null)
  const [players, setPlayers] = useState<ScannedPlayer[]>([])
  const [lastScannedPlayer, setLastScannedPlayer] = useState<ScannedPlayer | null>(null)
  const [arena, setArena] = useState('')
  const { data: arenas = [], error: arenasError, isLoading: arenasLoading, mutate: reloadArenas } = useSWR('arenas', fetchArenas)
  const [arenaListOpen, setArenaListOpen] = useState(false)
  const [activeArena, setActiveArena] = useState(-1)
  const arenaInputRef = useRef<HTMLInputElement>(null)
  const arenaListId = useId()
  const visibleArenas = filterArenas(arenas, arena)
  const arenaRef = useRef('')
  const [setupReady, setSetupReady] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState('')
  const [decodedText, setDecodedText] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (arenasError) console.error('Načítanie zoznamu arén zlyhalo:', arenasError)
  }, [arenasError])

  useEffect(() => {
    if (activeArena >= 0) document.getElementById(`${arenaListId}-${activeArena}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeArena, arenaListId])

  useEffect(() => {
    if (!lastScannedPlayer) return
    const timer = window.setTimeout(() => setLastScannedPlayer(null), 900)
    return () => window.clearTimeout(timer)
  }, [lastScannedPlayer])

  function chooseArena(name: string) {
    setArena(name)
    setArenaListOpen(false)
    setActiveArena(-1)
    arenaInputRef.current?.focus()
  }

  async function startSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isChecking) return
    setIsChecking(true)
    setError('')
    try {
      if (!arena.trim()) throw new Error(t('Vyplň názov arény.', 'Enter the arena name.'))
      arenaRef.current = arena.trim()
      liveMatchIdRef.current = crypto.randomUUID()
      deviceTokenRef.current = createQrDeviceToken()
      saveQrDeviceToken(liveMatchIdRef.current, deviceTokenRef.current)
      setSetupReady(true)
    } catch (setupError) {
      console.error('Príprava QR zápasu zlyhala:', setupError)
      setError(getErrorMessage(setupError, t('QR zápas sa nepodarilo pripraviť.', 'Could not prepare the QR match.')))
    } finally {
      setIsChecking(false)
    }
  }

  const createMatch = useCallback(async () => {
    const roster = playersRef.current
    if (roster.length !== 4 || creationRef.current) return
    creationRef.current = true
    setIsCreating(true)
    setError('')
    scannerRef.current?.stop()
    try {
      const { data, error: creationError } = await createClient().rpc('create_qr_device_match', {
        p_live_match_id: liveMatchIdRef.current,
        p_team_a_player1_id: roster[0].id,
        p_team_a_player2_id: roster[1].id,
        p_team_b_player1_id: roster[2].id,
        p_team_b_player2_id: roster[3].id,
        p_arena_name: arenaRef.current,
        p_device_token: deviceTokenRef.current,
      })
      if (creationError?.code === 'PGRST202') {
        throw new Error(tRef.current('V Supabase spusti SQL migráciu 052 pre QR zápasy bez prihlásenia.', 'Apply SQL migration 052 in Supabase for QR matches without login.'))
      }
      if (creationError) throw creationError
      if (typeof data !== 'string' || !/^[0-9a-f-]{36}$/i.test(data)) {
        throw new Error(tRef.current('Databáza nevrátila platné ID zápasu.', 'The database did not return a valid match ID.'))
      }
      router.push(`/match?id=${encodeURIComponent(data)}`)
    } catch (creationError) {
      console.error('Vytvorenie QR zápasu zlyhalo:', creationError)
      setError(getErrorMessage(creationError, tRef.current('QR zápas sa nepodarilo vytvoriť. Skús to znova.', 'Could not create the QR match. Please retry.')))
    } finally {
      creationRef.current = false
      setIsCreating(false)
    }
  }, [router])

  useEffect(() => {
    if (!setupReady) return
    let isActive = true
    let scanner: QrScanner | null = null
    let finishTimer: number | undefined
    let lastDecodedText: string | null = null

    async function startCamera() {
      setError('')
      setDecodedText(null)
      setIsStarting(true)
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error(tRef.current('Skenovanie potrebuje HTTPS a prehliadač s podporou kamery.', 'Scanning requires HTTPS and a browser with camera support.'))
        }
        const { default: Scanner } = await import('qr-scanner')
        if (!isActive || !videoRef.current || !viewfinderRef.current) return
        scanner = new Scanner(videoRef.current, (result) => {
          if (!isActive || processingRef.current || playersRef.current.length === 4 || lastDecodedText === result.data) return
          setDecodedText(result.data)
          lastDecodedText = result.data
          console.log('RIVA QR: detekovaný obsah:', result.data)
          processingRef.current = true
          setIsResolving(true)
          void (async () => {
            try {
              const id = getRivaProfilePath(result.data, window.location.origin).split('/')[2]
              if (playersRef.current.some((player) => player.id === id)) {
                throw new Error(tRef.current('Tento hráč je už v zápase. Naskenuj iného hráča.', 'This player is already in the match. Scan another player.'))
              }
              const { data, error: lookupError } = await createClient()
                .from('proffiles').select('id, full_name').eq('id', id).maybeSingle()
              if (lookupError) throw lookupError
              if (!data) throw new Error(tRef.current('Hráč z QR kódu sa nenašiel.', 'The QR player was not found.'))
              if (!isActive) return
              const next = [...playersRef.current, {
                id,
                name: typeof data.full_name === 'string' && data.full_name.trim() ? data.full_name.trim() : tRef.current(`Hráč ${id}`, `Player ${id}`),
              }]
              playersRef.current = next
              setPlayers(next)
              setLastScannedPlayer(next[next.length - 1])
              if (typeof navigator.vibrate === 'function') navigator.vibrate(60)
              setError('')
              if (next.length === 4) {
                finishTimer = window.setTimeout(() => {
                  if (isActive) void createMatch()
                }, 450)
              }
            } catch (scanError) {
              if (!isActive) return
              console.error('Priradenie QR hráča zlyhalo:', scanError)
              setError(getErrorMessage(scanError, tRef.current('Hráča sa nepodarilo pridať.', 'Could not add the player.')))
            } finally {
              processingRef.current = false
              if (isActive) setIsResolving(false)
            }
          })()
        }, {
          preferredCamera: 'environment',
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: false,
          overlay: viewfinderRef.current,
          calculateScanRegion: (video) => getQrScanRegion(video.videoWidth, video.videoHeight),
          onDecodeError: (decodeError) => {
            if (!isActive || decodeError === Scanner.NO_QR_CODE_FOUND || decodeError === `Scanner error: ${Scanner.NO_QR_CODE_FOUND}`) return
            console.error('Čítanie QR kódu zlyhalo:', decodeError)
            setError(getErrorMessage(decodeError, tRef.current('QR kód sa nepodarilo prečítať.', 'Could not read the QR code.')))
          },
        })
        scannerRef.current = scanner
        await scanner.start()
        if (!isActive) scanner.destroy()
      } catch (cameraError) {
        if (!isActive) return
        console.error('Spustenie QR kamery zlyhalo:', cameraError)
        setError(tRef.current('Kameru sa nepodarilo spustiť. Povoľ prístup ku kamere a skús to znova.', 'Could not start the camera. Allow access and try again.') + ' ' + getErrorMessage(cameraError, ''))
      } finally {
        if (isActive) setIsStarting(false)
      }
    }
    void startCamera()
    return () => {
      isActive = false
      if (finishTimer !== undefined) window.clearTimeout(finishTimer)
      scanner?.destroy()
      if (scannerRef.current === scanner) scannerRef.current = null
    }
  }, [attempt, setupReady, createMatch])

  function removeLastPlayer() {
    if (processingRef.current || creationRef.current) return
    const next = playersRef.current.slice(0, -1)
    playersRef.current = next
    setPlayers(next)
    setLastScannedPlayer(null)
    setAttempt((current) => current + 1)
  }

  const currentSlot = slots[players.length]
  return (
    <section className="mx-auto max-w-xl">
      <button type="button" onClick={onClose} disabled={isCreating} className="inline-flex min-h-11 items-center gap-2 text-sm text-white/60 hover:text-[#a8e63c]"><ArrowLeft size={17} aria-hidden="true" />{t('Späť na výber hry', 'Back to game selection')}</button>
      <div className="mt-5 rounded-3xl border border-violet-300/20 bg-[#0b1b22]/95 p-6 sm:p-8">
        <ScanQrCode size={36} className="text-violet-200" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-black">{t('QR ligový zápas', 'QR league match')}</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">{t('Prihlásenie na tomto zariadení nie je potrebné. Naskenujte QR kódy štyroch hráčov v poradí podľa miest. Skóre ovláda zariadenie, ktoré zápas vytvorí. ELO sa započíta až po potvrdení výsledku všetkými štyrmi hráčmi v ich profiloch.', 'No login is needed on this device. Scan four players in slot order. The device that creates the match controls the score. ELO is applied only after all four players approve the result in their profiles.')}</p>
        {!setupReady ? <form onSubmit={startSetup} className="mt-5 space-y-3">
          <div onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setArenaListOpen(false); setActiveArena(-1) } }}>
            <label htmlFor={`${arenaListId}-input`} className="block text-sm">{t('Aréna / kurt', 'Arena / court')}</label>
            <div className="relative mt-2">
              <input id={`${arenaListId}-input`} ref={arenaInputRef} required value={arena}
                role="combobox" aria-autocomplete="list" aria-expanded={arenaListOpen}
                aria-controls={arenaListId} aria-activedescendant={arenaListOpen && activeArena >= 0 ? `${arenaListId}-${activeArena}` : undefined}
                aria-describedby={`${arenaListId}-help`} autoComplete="off"
                placeholder={t('Vyber arénu alebo napíš názov či mesto', 'Choose an arena or type a name or city')}
                onFocus={() => setArenaListOpen(true)}
                onChange={(event) => { setArena(event.target.value); setArenaListOpen(true); setActiveArena(-1) }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') { event.preventDefault(); setArenaListOpen(false); setActiveArena(-1) }
                  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    setArenaListOpen(true)
                    if (visibleArenas.length) setActiveArena((current) => event.key === 'ArrowDown'
                      ? (current + 1) % visibleArenas.length
                      : (current <= 0 ? visibleArenas.length - 1 : current - 1))
                  } else if (event.key === 'Enter' && arenaListOpen && activeArena >= 0 && visibleArenas[activeArena]) {
                    event.preventDefault()
                    chooseArena(visibleArenas[activeArena].name)
                  }
                }}
                disabled={isChecking} className="min-h-12 w-full rounded-xl border border-white/20 bg-black/20 pl-3 pr-12 outline-none focus:border-[#a8e63c]" />
              <button type="button" disabled={isChecking} aria-label={t('Zobraziť zoznam arén', 'Show arena list')} aria-expanded={arenaListOpen} aria-controls={arenaListId}
                onClick={() => { setArenaListOpen((open) => !open); setActiveArena(-1) }}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-white/65 hover:text-[#a8e63c]"><ChevronDown size={18} aria-hidden="true" /></button>
            </div>
            {arenaListOpen ? <div className="mt-2 rounded-xl border border-white/15 bg-[#061016] p-1">
              <ul id={arenaListId} role="listbox" aria-label={t('Arény', 'Arenas')} className="max-h-60 overflow-y-auto">
                {visibleArenas.map((item, index) => <li id={`${arenaListId}-${index}`} key={item.id} role="option" aria-selected={activeArena === index}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => chooseArena(item.name)}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3 text-sm hover:bg-white/5 ${activeArena === index ? 'bg-[#a8e63c]/10 text-[#a8e63c]' : ''}`}>
                  <MapPin size={16} className="mt-0.5 shrink-0 text-[#a8e63c]" aria-hidden="true" />
                  <span><span className="block font-bold">{item.name}</span><span className="mt-1 block text-xs text-white/50">{[item.city, item.address].filter(Boolean).join(' · ')}</span></span>
                </li>)}
              </ul>
              {arenasLoading ? <p role="status" className="p-3 text-xs text-white/60">{t('Načítavam arény…', 'Loading arenas…')}</p> : !arenasError && visibleArenas.length === 0 ? <p role="status" className="p-3 text-xs text-white/60">{t('Žiadna zhoda. Môžeš použiť vlastný názov arény.', 'No matches. You can use your own arena name.')}</p> : null}
            </div> : null}
            <p id={`${arenaListId}-help`} className="mt-2 text-xs text-white/45">{t('Vyber zo zoznamu alebo zadaj vlastnú arénu. Hľadanie funguje aj bez diakritiky.', 'Select from the list or enter your own arena. Search also works without accents.')}</p>
            {arenasError ? <div role="alert" className="mt-2 text-xs text-amber-200">{t('Zoznam arén sa nepodarilo načítať. Vlastný názov môžeš zadať aj tak.', 'The arena list could not be loaded. You can still enter your own name.')} <button type="button" onClick={() => void reloadArenas()} className="underline">{t('Skúsiť znova', 'Retry')}</button></div> : null}
          </div>
          <button type="submit" disabled={isChecking} className="min-h-12 rounded-xl bg-[#a8e63c] px-5 font-bold text-[#061016]">{isChecking ? t('Pripravujem skener…', 'Preparing scanner…') : t('Začať skenovanie', 'Start scanning')}</button>
        </form> : <>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {slots.map((slot, index) => <div key={index} className={`rounded-xl border p-3 transition-colors duration-300 motion-reduce:transition-none ${index === players.length ? 'border-[#a8e63c] bg-[#a8e63c]/10' : players[index] ? 'border-[#a8e63c]/35 bg-[#a8e63c]/5' : 'border-white/15'}`}>
              <p className="text-xs text-white/65">{t('Tím', 'Team')} {slot.team} · {t('Hráč', 'Player')} {slot.player}</p>
              <p key={players[index]?.id ?? 'empty'} className={`mt-1 font-bold ${players[index] ? 'qr-player-arrival' : ''}`}>{players[index] ? <Check size={16} className="mr-1 inline text-[#a8e63c]" aria-hidden="true" /> : null}{players[index]?.name ?? t('Čaká na QR kód', 'Waiting for QR code')}</p>
            </div>)}
          </div>
          <h2 role="status" className="mt-5 text-center text-xl font-bold text-[#a8e63c]">{currentSlot ? `${t('Skenuj', 'Scan')}: ${t('Tím', 'Team')} ${currentSlot.team} · ${t('Hráč', 'Player')} ${currentSlot.player}` : t('Všetci hráči sú pridaní', 'All players added')}</h2>
          <p role="status" className="mt-2 min-h-6 text-center text-sm text-white/70">{lastScannedPlayer ? `${lastScannedPlayer.name} — ${t('hráč pridaný', 'player added')}` : t('Umiestni celý QR kód do zeleného rámčeka.', 'Place the entire QR code inside the green frame.')}</p>
          <div className={`relative mt-4 aspect-square overflow-hidden rounded-2xl border border-white/10 bg-black transition-opacity duration-300 motion-reduce:transition-none ${players.length === 4 && !lastScannedPlayer ? 'hidden' : ''} ${isCreating ? 'opacity-0' : 'opacity-100'}`}>
            <video ref={videoRef} autoPlay playsInline muted aria-label={t('Kamera QR skenera', 'QR scanner camera')} className="h-full w-full object-cover" />
            <div ref={viewfinderRef} aria-hidden="true" className={`qr-viewfinder ${lastScannedPlayer ? 'qr-viewfinder-success' : ''}`}
              style={{ left: `${(1 - QR_VIEWFINDER_RATIO) * 50}%`, top: `${(1 - QR_VIEWFINDER_RATIO) * 50}%`, width: `${QR_VIEWFINDER_RATIO * 100}%`, height: `${QR_VIEWFINDER_RATIO * 100}%` }}>
              <span className="qr-viewfinder-corner qr-viewfinder-top-left" />
              <span className="qr-viewfinder-corner qr-viewfinder-top-right" />
              <span className="qr-viewfinder-corner qr-viewfinder-bottom-left" />
              <span className="qr-viewfinder-corner qr-viewfinder-bottom-right" />
              {lastScannedPlayer ? <span key={lastScannedPlayer.id} className="qr-viewfinder-check"><Check size={40} /></span> : null}
            </div>
          </div>
          {isStarting || isResolving || isCreating ? <p role="status" className="mt-3 text-sm text-white/60">{isCreating ? t('Vytváram zápas…', 'Creating match…') : isResolving ? t('Overujem hráča…', 'Checking player…') : t('Spúšťam kameru…', 'Starting camera…')}</p> : null}
          <div className="mt-4 rounded-xl border border-white/15 bg-black/20 p-3 text-xs">
            <p className="font-semibold text-white/65">{t('Diagnostika QR – prečítaný obsah', 'QR diagnostics – decoded content')}</p>
            <pre role="status" className="mt-2 whitespace-pre-wrap break-all text-white">{decodedText === null ? t('Zatiaľ nebol rozpoznaný žiadny QR kód.', 'No QR code detected yet.') : decodedText}</pre>
          </div>
          {!isStarting && !isCreating && !isResolving && !(players.length === 4 && lastScannedPlayer) ? <div className="mt-4 flex flex-wrap gap-3">
            {players.length === 4 ? <button type="button" onClick={() => void createMatch()} className="min-h-11 rounded-xl bg-[#a8e63c] px-4 font-bold text-[#061016]">{t('Skúsiť vytvoriť zápas znova', 'Retry creating match')}</button> : <button type="button" onClick={() => setAttempt((current) => current + 1)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-sm"><Camera size={17} aria-hidden="true" />{t('Skenovať znova', 'Scan again')}</button>}
            {players.length > 0 ? <button type="button" onClick={removeLastPlayer} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm">{t('Odobrať posledného hráča', 'Remove last player')}</button> : null}
          </div> : null}
        </>}
        {error ? <p role="alert" className="mt-4 rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      </div>
    </section>
  )
}
