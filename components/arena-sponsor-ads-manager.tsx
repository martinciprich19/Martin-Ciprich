'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const BUCKET = 'arena-sponsor-ads'
const MAX_FILE_SIZE = 5 * 1024 * 1024
const FILE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

type SponsorAd = {
  id: string
  arena_id: number | string
  sponsor_name: string
  image_path: string
  display_seconds: number
  sort_order: number
  is_active: boolean
}

export function ArenaSponsorAdsManager({ arenaId }: { arenaId: string }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [ads, setAds] = useState<SponsorAd[]>([])
  const [sponsorName, setSponsorName] = useState('')
  const [displaySeconds, setDisplaySeconds] = useState('10')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadAds = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: queryError } = await createClient()
      .from('arena_sponsor_ads')
      .select('id, arena_id, sponsor_name, image_path, display_seconds, sort_order, is_active')
      .eq('arena_id', arenaId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (queryError) {
      console.error('Could not load arena sponsor ads:', queryError)
      setError('Sponzorské obrázky sa nepodarilo načítať. Skontroluj, či je spustená migrácia 073.')
    } else {
      setAds((data ?? []) as SponsorAd[])
    }
    setLoading(false)
  }, [arenaId])

  useEffect(() => {
    void loadAds()
  }, [loadAds])

  async function addAd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return

    const name = sponsorName.trim()
    const seconds = Number(displaySeconds)
    const file = fileInput.current?.files?.[0]
    if (!name) {
      setError('Zadaj názov sponzora.')
      return
    }
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 60) {
      setError('Čas zobrazenia musí byť od 5 do 60 sekúnd.')
      return
    }
    if (!file) {
      setError('Vyber obrázok alebo logo.')
      return
    }
    if (!(file.type in FILE_EXTENSIONS)) {
      setError('Podporované sú iba obrázky PNG, JPG a WebP.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Obrázok môže mať najviac 5 MB.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    const supabase = createClient()
    const path = `${arenaId}/${crypto.randomUUID()}.${FILE_EXTENSIONS[file.type]}`
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false })

    if (uploadError) {
      console.error('Could not upload arena sponsor image:', uploadError)
      setError('Obrázok sa nepodarilo nahrať. Skontroluj migráciu 073 a oprávnenie správcu arény.')
      setSaving(false)
      return
    }

    const { error: insertError } = await supabase
      .from('arena_sponsor_ads')
      .insert({
        arena_id: arenaId,
        sponsor_name: name,
        image_path: path,
        display_seconds: seconds,
        sort_order: ads.length,
      })

    if (insertError) {
      console.error('Could not save arena sponsor ad:', insertError)
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([path])
      if (cleanupError) console.error('Could not clean up unregistered sponsor image:', cleanupError)
      setError('Obrázok sa nahral, ale jeho údaje sa nepodarilo uložiť. Skontroluj migráciu 073.')
      setSaving(false)
      return
    }

    setSponsorName('')
    if (fileInput.current) fileInput.current.value = ''
    setNotice('Sponzorský obrázok bol pridaný do rotácie.')
    await loadAds()
    setSaving(false)
  }

  async function toggleAd(ad: SponsorAd) {
    if (saving) return
    setSaving(true)
    setError('')
    setNotice('')
    const { error: updateError } = await createClient()
      .from('arena_sponsor_ads')
      .update({ is_active: !ad.is_active })
      .eq('id', ad.id)
      .eq('arena_id', arenaId)

    if (updateError) {
      console.error('Could not update arena sponsor ad:', updateError)
      setError('Stav sponzorského obrázka sa nepodarilo zmeniť.')
    } else {
      setNotice(ad.is_active ? 'Sponzorský obrázok bol pozastavený.' : 'Sponzorský obrázok je aktívny.')
      await loadAds()
    }
    setSaving(false)
  }

  async function deleteAd(ad: SponsorAd) {
    if (saving || !window.confirm(`Naozaj odstrániť reklamu „${ad.sponsor_name}“?`)) return
    setSaving(true)
    setError('')
    setNotice('')
    const supabase = createClient()
    const { error: deleteRowError } = await supabase
      .from('arena_sponsor_ads')
      .delete()
      .eq('id', ad.id)
      .eq('arena_id', arenaId)

    if (deleteRowError) {
      console.error('Could not delete arena sponsor ad:', deleteRowError)
      setError('Sponzorský obrázok sa nepodarilo odstrániť.')
      setSaving(false)
      return
    }

    const { error: removeFileError } = await supabase.storage.from(BUCKET).remove([ad.image_path])
    if (removeFileError) {
      console.error('Could not remove deleted sponsor image from storage:', removeFileError)
      setError('Reklama bola odobratá z rotácie, ale súbor sa nepodarilo odstrániť z úložiska.')
    } else {
      setNotice('Sponzorský obrázok bol odstránený.')
    }
    await loadAds()
    setSaving(false)
  }

  function imageUrl(path: string) {
    return createClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  }

  return (
    <section className="mt-7 rounded-2xl border border-app-line/10 bg-app-panel p-5 sm:p-7" aria-labelledby="sponsor-ads-heading">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-app-league">PREZENTÁCIA</p>
        <h2 id="sponsor-ads-heading" className="mt-1 text-xl font-black">Sponzori na monitore</h2>
        <p className="mt-2 text-sm leading-6 text-app-fg/50">Keď sa na tomto kurte nehrá, monitor bude aktívne reklamy postupne zobrazovať. Počas zápasu má prednosť živé skóre.</p>
      </div>

      <form onSubmit={addAd} className="mt-5 grid gap-3 rounded-xl border border-app-line/10 bg-app-ink/60 p-4 sm:grid-cols-2">
        <label className="text-xs font-semibold text-app-fg/65">
          Názov sponzora
          <input value={sponsorName} onChange={(event) => setSponsorName(event.target.value)} maxLength={100} required placeholder="Napríklad RIVA Padel" className="mt-1.5 min-h-11 w-full rounded-lg border border-app-line/15 bg-app-ink px-3 text-sm text-app-fg outline-none focus:border-[#ccff00]/60" />
        </label>
        <label className="text-xs font-semibold text-app-fg/65">
          Dĺžka zobrazenia (5–60 sekúnd)
          <input type="number" min={5} max={60} step={1} value={displaySeconds} onChange={(event) => setDisplaySeconds(event.target.value)} required className="mt-1.5 min-h-11 w-full rounded-lg border border-app-line/15 bg-app-ink px-3 text-sm text-app-fg outline-none focus:border-[#ccff00]/60" />
        </label>
        <label className="text-xs font-semibold text-app-fg/65 sm:col-span-2">
          Obrázok alebo logo (PNG, JPG, WebP; max. 5 MB)
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" required className="mt-1.5 block min-h-11 w-full rounded-lg border border-app-line/15 bg-app-ink px-3 py-2 text-xs text-app-fg/65 file:mr-3 file:rounded-md file:border-0 file:bg-[#ccff00] file:px-3 file:py-1 file:text-xs file:font-bold file:text-[#10150d]" />
        </label>
        <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#ccff00] px-4 text-sm font-black text-[#10150d] disabled:opacity-50 sm:col-span-2 sm:justify-self-start">
          {saving ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
          Pridať do rotácie
        </button>
      </form>

      {error ? <p role="alert" className="mt-4 rounded-lg border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</p> : null}

      {loading ? (
        <p role="status" className="mt-5 flex items-center justify-center gap-2 py-5 text-sm text-app-fg/50"><LoaderCircle size={17} className="animate-spin" /> Načítavam sponzorov…</p>
      ) : ads.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-app-line/15 p-5 text-center text-sm text-app-fg/50">Zatiaľ nie sú pridané reklamy. Monitor zobrazí obrazovku „Kurt je pripravený“, kým nepridáš sponzora.</p>
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {ads.map((ad) => (
            <li key={ad.id} className="overflow-hidden rounded-xl border border-app-line/10 bg-app-ink/50">
              <div className="flex h-32 items-center justify-center bg-black/30 p-3">
                <img src={imageUrl(ad.image_path)} alt={`Logo alebo reklama: ${ad.sponsor_name}`} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{ad.sponsor_name}</p>
                  <p className="mt-1 text-xs text-app-fg/45">{ad.display_seconds} sek. · {ad.is_active ? 'V rotácii' : 'Pozastavené'}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" disabled={saving} onClick={() => void toggleAd(ad)} className="rounded-lg border border-app-line/15 px-3 py-2 text-xs font-bold hover:border-[#ccff00]/40 disabled:opacity-50">
                    {ad.is_active ? 'Pozastaviť' : 'Aktivovať'}
                  </button>
                  <button type="button" disabled={saving} onClick={() => void deleteAd(ad)} aria-label={`Odstrániť reklamu ${ad.sponsor_name}`} className="rounded-lg border border-red-400/20 p-2 text-red-200 hover:bg-red-500/10 disabled:opacity-50">
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
