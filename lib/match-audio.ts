import type { Language } from '@/components/language-provider'

export type MatchSpeechStatus = 'ready' | 'fallback' | 'unsupported' | 'missing' | 'failed'

type MatchAudioOptions = {
  matchId: string
  isMuted: () => boolean
  onStatus: (status: MatchSpeechStatus) => void
  fallback: (text: string, language: Language) => void
  stopFallback: () => void
}

export class MatchAudio {
  private revision = 0
  private request: AbortController | null = null
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null

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

  private releaseAudio() {
    if (this.audio) {
      this.audio.onended = null
      this.audio.onerror = null
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
      this.audio = null
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }

  async speak(text: string, language: Language): Promise<void> {
    this.stop()
    if (this.options.isMuted()) return
    const revision = this.revision
    const request = new AbortController()
    this.request = request
    const timeout = setTimeout(() => request.abort(), 15000)
    const isCurrent = () => revision === this.revision && !this.options.isMuted()
    let usedFallback = false
    const fallback = (error: unknown) => {
      if (!isCurrent() || usedFallback) return
      usedFallback = true
      console.warn('ElevenLabs prehrávanie zlyhalo; používam hlas zariadenia:', error)
      this.releaseAudio()
      this.options.fallback(text, language)
    }
    try {
      const response = await fetch('/api/match-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, matchId: this.options.matchId }),
        signal: request.signal,
      })
      if (!response.ok) throw new Error(`Hlasová služba HTTP ${response.status}`)
      const blob = await response.blob()
      if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Hlasová služba nevrátila zvuk.')
      if (!isCurrent()) return
      this.objectUrl = URL.createObjectURL(blob)
      const audio = new Audio(this.objectUrl)
      this.audio = audio
      audio.onended = () => { if (isCurrent()) this.releaseAudio() }
      audio.onerror = () => fallback(new Error('Zvuk sa nepodarilo prehrať.'))
      await audio.play()
      if (isCurrent() && this.audio === audio) this.options.onStatus('ready')
    } catch (error) {
      fallback(error)
    } finally {
      clearTimeout(timeout)
      if (this.request === request) this.request = null
    }
  }
}
