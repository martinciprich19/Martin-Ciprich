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

export class MatchAudio {
  private revision = 0
  private request: AbortController | null = null
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private celebrated = false
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
    await this.speak(text, language)
  }

  private releaseAudio() {
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
