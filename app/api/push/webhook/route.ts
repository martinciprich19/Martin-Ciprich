import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createPushAdminClient, deliverPush } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET
  const header = request.headers.get('authorization') ?? ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header)
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let event: unknown
  try { event = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!event || typeof event !== 'object'
    || !('type' in event) || event.type !== 'INSERT'
    || !('schema' in event) || event.schema !== 'public'
    || !('table' in event) || event.table !== 'notifications'
    || !('record' in event) || !event.record || typeof event.record !== 'object'
    || !('id' in event.record) || !['string', 'number'].includes(typeof event.record.id)) {
    return NextResponse.json({ error: 'Expected notifications INSERT event' }, { status: 400 })
  }
  try {
    const supabase = createPushAdminClient()
    const id = String(event.record.id)
    // Never trust webhook-supplied recipients or content; read the stored event.
    const { data: row, error: rowError } = await supabase.from('notifications').select('*').eq('id', id).single()
    if (rowError) throw rowError
    const tokens: string[] = []
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.rpc('push_notification_tokens', { p_notification_id: id }).range(start, start + 999)
      if (error) throw error
      if (!Array.isArray(data) || !data.every((token): token is string => typeof token === 'string')) throw new Error('Unexpected push recipients.')
      tokens.push(...data)
      if (data.length < 1000) break
    }
    if (!tokens.length) return NextResponse.json({ sent: 0, failed: 0 })
    const titles: Record<string, string> = {
      friend_request: 'Žiadosť o priateľstvo',
      pair_challenge: 'Nová výzva na zápas',
      challenge_request: 'Nová výzva na zápas',
      message: 'Nová správa',
      new_message: 'Nová správa',
      direct_message: 'Nová správa',
    }
    const result = await deliverPush(tokens, {
      title: String(row.title || titles[String(row.type)] || 'RIVA Padel').slice(0, 150),
      body: String(row.message ?? row.body ?? '').slice(0, 500),
      id: `notification-${id}`,
    })
    return NextResponse.json(result, { status: result.failed ? 502 : 200 })
  } catch (error) {
    console.error('Push webhook failed:', error)
    return NextResponse.json({ error: 'Push delivery failed' }, { status: 503 })
  }
}
