import { createClient } from '@/lib/supabase/server'
import { createHash } from 'node:crypto'
import { getWinnerAnnouncement } from '@/lib/live-match-scoring'

export const runtime = 'nodejs'

const standaloneScores = new Map<string, string>([
  ['0', 'Nula.'],
  ['15', 'Pätnásť.'],
  ['30', 'Tridsať.'],
  ['40', 'Štyridsať.'],
  ['Nula', 'Nula.'],
  ['Pätnásť', 'Pätnásť.'],
  ['Tridsať', 'Tridsať.'],
  ['Štyridsať', 'Štyridsať.'],
  ['Zhoda', 'Zhoda.'],
  ['Výhoda', 'Výhoda.'],
])
const allowedAnnouncements = new Set<string>([
  'Skóre gemu bolo vynulované.',
  'Game score reset.',
  ...standaloneScores.values(),
])
for (const team of [1, 2]) {
  const slovakTeam = team === 1 ? 'jedna' : 'dva'
  allowedAnnouncements.add(`Bod pre tím ${slovakTeam}.`)
  allowedAnnouncements.add(`Bod pre tím ${slovakTeam}, gem pre tím ${slovakTeam}.`)
  allowedAnnouncements.add(`Gem pre tím ${slovakTeam}.`)
  allowedAnnouncements.add(`Point for Team ${team}.`)
  allowedAnnouncements.add(`Point for Team ${team}, game for Team ${team}.`)
  allowedAnnouncements.add(`Podáva Tím ${team}.`)
  allowedAnnouncements.add(`Team ${team} serves.`)
  for (const player of [1, 2]) {
    allowedAnnouncements.add(`Podáva Tím ${team}, hráč ${player}.`)
    allowedAnnouncements.add(`Team ${team}, player ${player} serves.`)
  }
}
for (const a of [0, 15, 30, 40]) {
  for (const b of [0, 15, 30, 40]) {
    allowedAnnouncements.add(`Posledná zmena bola vrátená. Skóre ${a} ku ${b}.`)
    allowedAnnouncements.add(`Last change undone. Score ${a} to ${b}.`)
  }
}

const audioCache = new Map<string, ArrayBuffer>()
const pendingAudio = new Map<string, Promise<ArrayBuffer>>()
let synthesisWindow = 0
let synthesisCount = 0

class ElevenLabsApiError extends Error {
  readonly status: number
  readonly details: string

  constructor(status: number, details: string) {
    super(`ElevenLabs HTTP ${status}`)
    this.name = 'ElevenLabsApiError'
    this.status = status
    this.details = details
  }
}

async function synthesize(text: string, voice: string, apiKey: string): Promise<ArrayBuffer> {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey, Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.95, similarity_boost: 0.75, speed: 0.80, style: 0 },
    }),
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  })
  if (!response.ok) {
    const details = (await response.text()).replaceAll(apiKey, '[REDACTED]')
    console.error('ElevenLabs API error:', response.status, details)
    throw new ElevenLabsApiError(response.status, details)
  }
  if (!response.headers.get('content-type')?.startsWith('audio/')) {
    throw new Error('ElevenLabs did not return audio.')
  }
  const audio = await response.arrayBuffer()
  if (!audio.byteLength || audio.byteLength > 2_000_000) throw new Error('Invalid ElevenLabs audio size.')
  return audio
}

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  console.log('Použitý ElevenLabs Key (SHA256 odtlačok):', apiKey
    ? createHash('sha256').update(apiKey).digest('hex').slice(0, 12)
    : 'nenastavený')
  const url = new URL(request.url)
  const expectedOrigin = `${url.protocol}//${request.headers.get('host') ?? url.host}`
  if (request.headers.get('origin') !== expectedOrigin) {
    console.error('Match speech origin rejected:', {
      origin: request.headers.get('origin'),
      expectedOrigin,
    })
    return Response.json({ error: 'Neplatný pôvod požiadavky.' }, { status: 403 })
  }
  const voice = process.env.ELEVENLABS_VOICE_ID ?? '2bNrEsM0omyhLiEyOwqY'
  if (!apiKey || !/^[a-zA-Z0-9]{20}$/.test(voice)) {
    console.error('ElevenLabs configuration error:', {
      apiKeyConfigured: Boolean(apiKey),
      voiceIdValid: /^[a-zA-Z0-9]{20}$/.test(voice),
    })
    return Response.json({ error: 'Hlas ElevenLabs nie je nakonfigurovaný.' }, { status: 503 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Neplatná požiadavka.' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || !('text' in body) || !('matchId' in body)
    || typeof body.text !== 'string'
    || typeof body.matchId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.matchId)) {
    return Response.json({ error: 'Neplatné hlásenie alebo zápas.' }, { status: 400 })
  }
  const trimmedText = body.text.trim()
  const scoreToken = trimmedText.endsWith('.') ? trimmedText.slice(0, -1) : trimmedText
  const text = standaloneScores.get(scoreToken) ?? trimmedText
  const isWinnerAnnouncement = text.startsWith('Zápas vyhral tím ') || text.startsWith('Team 1 won the match.') || text.startsWith('Team 2 won the match.')
  if (!text.endsWith('.') || (!allowedAnnouncements.has(text) && !isWinnerAnnouncement)) {
    return Response.json({ error: 'Neplatné hlásenie alebo zápas.' }, { status: 400 })
  }
  try {
    const supabase = await createClient(AbortSignal.timeout(5000))
    const { data, error } = await supabase.from('live_matches')
      .select('id, team_a_sets, team_b_sets, team_a_player1_name, team_a_player2_name, team_b_player1_name, team_b_player2_name')
      .eq('id', body.matchId).maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Zápas nie je dostupný.' }, { status: 404 })
    if (isWinnerAnnouncement) {
      const announcement = getWinnerAnnouncement(data)
      if (!announcement || (text !== announcement.sk && text !== announcement.en)) {
        return Response.json({ error: 'Neplatné hlásenie víťaza zápasu.' }, { status: 400 })
      }
    }
    const cacheKey = `${voice}:${text}`
    let audio = audioCache.get(cacheKey)
    if (!audio) {
      let pending = pendingAudio.get(cacheKey)
      if (!pending) {
        const now = Date.now()
        if (now - synthesisWindow >= 60_000) { synthesisWindow = now; synthesisCount = 0 }
        if (synthesisCount >= 60 || pendingAudio.size >= 4) {
          return Response.json({ error: 'Hlasová služba je vyťažená.' }, { status: 429 })
        }
        synthesisCount++
        pending = synthesize(text, voice, apiKey).then((result) => {
          if (audioCache.size >= 128) audioCache.clear()
          audioCache.set(cacheKey, result)
          return result
        }).finally(() => pendingAudio.delete(cacheKey))
        pendingAudio.set(cacheKey, pending)
      }
      audio = await pending
    }
    return new Response(audio, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    if (error instanceof ElevenLabsApiError) {
      return Response.json({
        error: error.details,
        provider: 'ElevenLabs',
        providerStatus: error.status,
      }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
    }
    const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error('ElevenLabs API error:', 'request failed', details.replaceAll(apiKey, '[REDACTED]'))
    return Response.json({ error: 'ElevenLabs nie je dostupný. Použije sa hlas zariadenia.' }, { status: 502 })
  }
}
