import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createDatabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
function database() {
  return createDatabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
}
export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.has('courtId')) {
      const courtId = request.nextUrl.searchParams.get('courtId')!
      if (!/^[1-9]\d*$/.test(courtId) || !Number.isSafeInteger(Number(courtId))) {
        return NextResponse.json({ error: 'Neplatný kurt.' }, { status: 400 })
      }
      const db = await createClient()
      const { data: { user }, error: authError } = await db.auth.getUser()
      if (!user) return NextResponse.json({ error: 'Prihlás sa ako správca.' }, { status: 401 })
      if (authError) throw authError
      const { data, error } = await db.rpc('request_kiosk_preview', { p_court_id: courtId })
      if (error?.code === '42501') return NextResponse.json({ error: 'Nemáš prístup k tomuto kurtu.' }, { status: 403 })
      if (error) throw error
      return NextResponse.json({ preview: data?.[0] ?? null }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const token = request.cookies.get('riva-kiosk-device')?.value
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ requested: false })
    const { data, error } = await database().rpc('kiosk_preview_requested', { p_token: token })
    if (error) throw error
    return NextResponse.json({ requested: data === true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Kiosk preview load failed:', error)
    return NextResponse.json({ error: 'Náhľad sa nepodarilo načítať. Over migráciu 083.' }, { status: 503 })
  }
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Nepovolený pôvod požiadavky.' }, { status: 403 })
  const token = request.cookies.get('riva-kiosk-device')?.value
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: 'Neautorizované zariadenie.' }, { status: 401 })
  if (request.headers.get('content-type') !== 'image/jpeg'
    || Number(request.headers.get('content-length')) > 400000) {
    return NextResponse.json({ error: 'Neplatný obrázok.' }, { status: 400 })
  }
  try {
    const reader = request.body?.getReader()
    if (!reader) return NextResponse.json({ error: 'Chýba obrázok.' }, { status: 400 })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 400000) { await reader.cancel(); return NextResponse.json({ error: 'Obrázok je príliš veľký.' }, { status: 413 }) }
      chunks.push(value)
    }
    const { error } = await database().rpc('publish_kiosk_preview', {
      p_token: token, p_image: Buffer.concat(chunks).toString('base64'),
    })
    if (error?.code === '42501') return NextResponse.json({ error: 'Neautorizované zariadenie.' }, { status: 403 })
    if (error?.code === '55000') return NextResponse.json({ error: 'Náhľad už nie je vyžiadaný.' }, { status: 409 })
    if (error?.code === '22023') return NextResponse.json({ error: 'Neplatný obrázok.' }, { status: 400 })
    if (error) throw error
    return NextResponse.json({ uploaded: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Kiosk preview upload failed:', error)
    return NextResponse.json({ error: 'Náhľad sa nepodarilo odoslať.' }, { status: 503 })
  }
}
