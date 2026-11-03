import type { Language } from '@/components/language-provider'

export type MatchSpeechStatus = 'ready' | 'fallback' | 'unsupported' | 'missing' | 'failed'
export type MatchSpeechFailure = 'service' | 'network' | 'playback' | 'blocked'

type MatchAudioOptions = {
  matchId: string
  isMuted: () => boolean
  onStatus: (status: MatchSpeechStatus, failure?: MatchSpeechFailure) => void
  fallback: (text: string, language: Language) => void
  stopFallback: () => void
}

function createVictoryFanfare(): Blob {
  const sampleRate = 22050
  const duration = 2.4
  const samples = Math.round(sampleRate * duration)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, samples * 2, true)
  // Original rising major arpeggio, ending in a sustained victory chord.
  const notes = [
    { start: 0, length: 0.24, frequencies: [523.25] },
    { start: 0.28, length: 0.24, frequencies: [523.25] },
    { start: 0.56, length: 0.24, frequencies: [659.25] },
    { start: 0.84, length: 0.24, frequencies: [783.99] },
    { start: 1.12, length: 1.28, frequencies: [523.25, 659.25, 783.99, 1046.5] },
  ]
  for (let index = 0; index < samples; index++) {
    const time = index / sampleRate
    let value = 0
    for (const note of notes) {
      const elapsed = time - note.start
      if (elapsed < 0 || elapsed >= note.length) continue
      const envelope = Math.min(elapsed / 0.015, 1, (note.length - elapsed) / 0.12)
      for (const frequency of note.frequencies) {
        const phase = 2 * Math.PI * frequency * elapsed
        value += envelope * (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase))
          / note.frequencies.length
      }
    }
    view.setInt16(44 + index * 2, Math.round(value * 0.4 * 32767), true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export class MatchAudio {
  private revision = 0
  private request: AbortController | null = null
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private celebrated = false
  private finishFanfare: (() => void) | null = null
  private readonly clips = new Map<string, Blob>()
  private clipBytes = 0

  private readonly options: MatchAudioOptions

  constructor(options: MatchAudioOptions) {
    this.options = options
  }

  stop() {
    this.revision++
    this.request?.abort()
    this.request = null
    this.releaseAudio()
    this.options.stopFallback()
  }

  async celebrate(text: string, language: Language): Promise<void> {
    if (this.celebrated) return
    this.celebrated = true
    await this.speakAnnouncement(text, language, true)
  }

  resetCelebration() {
    this.stop()
    this.celebrated = false
  }

  private releaseAudio() {
    this.finishFanfare?.()
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }

  async speak(text: string, language: Language): Promise<void> {
    await this.speakAnnouncement(text, language)
  }

  private async playFanfare(): Promise<void> {
    this.objectUrl = URL.createObjectURL(createVictoryFanfare())
    const audio = this.audio ?? new Audio()
    this.audio = audio
    audio.src = this.objectUrl
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.finishFanfare = null
        audio.onended = null
        audio.onerror = null
        if (error) reject(error)
        else resolve()
      }
      const timeout = setTimeout(() => finish(new Error('Víťazné fanfáry sa nedohrali.')), 5000)
      this.finishFanfare = () => finish()
      audio.onended = () => finish()
      audio.onerror = () => finish(new Error('Víťazné fanfáry sa nepodarilo prehrať.'))
      try {
        void audio.play().catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error('Víťazné fanfáry sa nepodarilo spustiť.'))
        })
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Víťazné fanfáry sa nepodarilo spustiť.'))
      }
    })
  }

  private async speakAnnouncement(text: string, language: Language, fanfare = false): Promise<void> {
    this.stop()
    if (this.options.isMuted()) return
    const revision = this.revision
    const request = new AbortController()
    this.request = request
    const timeout = setTimeout(() => request.abort(), 15000)
    const isCurrent = () => revision === this.revision && !this.options.isMuted()
    let usedFallback = false
    let failure: MatchSpeechFailure = 'network'
    const fallback = (error: unknown) => {
      if (!isCurrent() || usedFallback) return
      usedFallback = true
      console.warn('Hlasové hlásenie zlyhalo; skúšam záložný hlas zariadenia:', failure, error)
      this.releaseAudio()
      this.options.onStatus('failed', failure)
      this.options.fallback(text, language)
    }
    try {
      if (fanfare) {
        try {
          await this.playFanfare()
        } catch (error) {
          if (!isCurrent()) return
          console.warn('Víťazné fanfáry zlyhali; pokračujem oznámením víťazov:', error)
          this.options.onStatus('failed', error instanceof Error && error.name === 'NotAllowedError' ? 'blocked' : 'playback')
          this.releaseAudio()
        }
        if (!isCurrent()) return
        this.releaseAudio()
      }
      const key = `${language}:${text}`
      let blob = this.clips.get(key)
      if (!blob) {
        const response = await fetch('/api/match-speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, matchId: this.options.matchId, language }),
          signal: request.signal,
        })
        failure = 'service'
        if (!response.ok) throw new Error(`Hlasová služba HTTP ${response.status}`)
        blob = await response.blob()
        if (!blob.size || blob.size > 2_000_000 || !blob.type.startsWith('audio/')) throw new Error('Hlasová služba nevrátila platný zvuk.')
        if (!isCurrent()) return
        while (this.clips.size >= 64 || this.clipBytes + blob.size > 8_000_000) {
          const oldest = this.clips.keys().next().value
          if (oldest === undefined) break
          this.clipBytes -= this.clips.get(oldest)?.size ?? 0
          this.clips.delete(oldest)
        }
        this.clips.set(key, blob)
        this.clipBytes += blob.size
      }
      if (!isCurrent()) return
      failure = 'playback'
      this.objectUrl = URL.createObjectURL(blob)
      const audio = this.audio ?? new Audio()
      this.audio = audio
      audio.src = this.objectUrl
      audio.onended = () => { if (isCurrent()) this.releaseAudio() }
      audio.onerror = () => fallback(new Error('Zvuk sa nepodarilo prehrať.'))
      try {
        await audio.play()
      } catch (error) {
        if (error instanceof Error && error.name === 'NotAllowedError') failure = 'blocked'
        throw error
      }
      if (isCurrent() && this.audio === audio) this.options.onStatus('ready')
    } catch (error) {
      fallback(error)
    } finally {
      clearTimeout(timeout)
      if (this.request === request) this.request = null
    }
  }
}
