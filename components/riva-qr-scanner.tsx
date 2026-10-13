'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Camera, ScanQrCode } from 'lucide-react'
import type QrScanner from 'qr-scanner'
import { useLanguage } from '@/components/language-provider'
import { getErrorMessage } from '@/lib/errors'
import { getRivaProfilePath } from '@/lib/riva-qr'

export function RivaQrScanner({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [profilePath, setProfilePath] = useState('')
  const [error, setError] = useState('')
  const [isStarting, setIsStarting] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let isActive = true
    let scanner: QrScanner | null = null

    async function startCamera() {
      setError('')
      setProfilePath('')
      setIsStarting(true)
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error(t('Skenovanie potrebuje HTTPS a prehliadač s podporou kamery.', 'Scanning requires HTTPS and a browser with camera support.'))
        }
        const { default: Scanner } = await import('qr-scanner')
        if (!isActive || !videoRef.current) return
        scanner = new Scanner(videoRef.current, (result) => {
          if (!isActive) return
          try {
            const path = getRivaProfilePath(result.data, window.location.origin)
            scanner?.stop()
            setError('')
            setProfilePath(path)
          } catch (decodeError: unknown) {
            setError(getErrorMessage(decodeError, t('QR kód nie je platný.', 'The QR code is not valid.')))
          }
        }, {
          preferredCamera: 'environment',
          returnDetailedScanResult: true,
          onDecodeError: (decodeError) => {
            if (!isActive || decodeError === Scanner.NO_QR_CODE_FOUND) return
            console.error('Čítanie QR kódu zlyhalo:', decodeError)
            scanner?.stop()
            setError(getErrorMessage(decodeError, t('QR kód sa nepodarilo prečítať.', 'Could not read the QR code.')))
          },
        })
        await scanner.start()
        if (!isActive) scanner.destroy()
      } catch (cameraError: unknown) {
        if (!isActive) return
        console.error('Spustenie QR kamery zlyhalo:', cameraError)
        setError(t('Kameru sa nepodarilo spustiť. Povoľ prístup ku kamere a skús to znova.', 'Could not start the camera. Allow camera access and try again.') + ' ' + getErrorMessage(cameraError, ''))
      } finally {
        if (isActive) setIsStarting(false)
      }
    }

    void startCamera()
    return () => {
      isActive = false
      scanner?.destroy()
    }
  }, [attempt, t])

  return (
    <section className="mx-auto max-w-xl">
      <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2 text-sm text-white/60 hover:text-[#a8e63c]"><ArrowLeft size={17} aria-hidden="true" />{t('Späť na výber hry', 'Back to game selection')}</button>
      <div className="mt-5 rounded-3xl border border-violet-300/20 bg-[#0b1b22]/95 p-6 sm:p-8">
        <ScanQrCode size={36} className="text-violet-200" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-black">{t('Naskenuj svoj RIVA QR kód', 'Scan your RIVA QR code')}</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">{t('Otvor osobný QR kód v hráčskom profile a podrž ho pred kamerou.', 'Open the personal QR code in your player profile and hold it in front of the camera.')}</p>
        <div className={`relative mt-6 aspect-square overflow-hidden rounded-2xl border border-white/10 bg-black ${profilePath ? 'hidden' : ''}`}>
          <video ref={videoRef} autoPlay playsInline muted aria-label={t('Kamera QR skenera', 'QR scanner camera')} className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-10 rounded-2xl border-2 border-violet-200/70" />
        </div>
        {isStarting ? <p role="status" className="mt-4 text-sm text-white/60">{t('Spúšťam kameru…', 'Starting camera…')}</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
        {profilePath ? <div className="mt-6 rounded-2xl border border-[#a8e63c]/25 bg-[#a8e63c]/5 p-5">
          <p role="status" className="font-semibold text-[#c1fa66]">{t('RIVA QR kód bol rozpoznaný.', 'RIVA QR code recognized.')}</p>
          <Link href={profilePath} className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-[#a8e63c] px-5 text-sm font-bold text-[#061016] hover:bg-[#c1fa66]">{t('Otvoriť profil hráča', 'Open player profile')}</Link>
        </div> : null}
        {!isStarting ? <button type="button" onClick={() => setAttempt((current) => current + 1)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-white/75 hover:bg-white/5"><Camera size={17} aria-hidden="true" />{t('Skenovať znova', 'Scan again')}</button> : null}
      </div>
    </section>
  )
}
