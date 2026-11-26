import { createClient } from '@/lib/supabase/client'

const AVATAR_BUCKET = 'avatars'
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_AVATAR_SIZE = 5 * 1024 * 1024

function ownedAvatarTarget(supabase: ReturnType<typeof createClient>, userId: string, url: string): { bucket: string; path: string } | null {
  const avatarUrl = new URL(url)
  for (const bucket of [AVATAR_BUCKET, 'player-avatars']) {
    const base = new URL(supabase.storage.from(bucket).getPublicUrl('').data.publicUrl)
    const prefix = `${base.pathname.replace(/\/+$/, '')}/`
    if (avatarUrl.origin !== base.origin || !avatarUrl.pathname.startsWith(prefix)) continue
    const path = decodeURIComponent(avatarUrl.pathname.slice(prefix.length))
    const parts = path.split('/')
    if (parts[0] !== userId || parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
      throw new Error('Cesta k profilovej fotografii nie je platná.')
    }
    return { bucket, path }
  }
  return null
}

export async function saveProfileAvatar(file: File): Promise<{ url: string; cleanupWarning: boolean }> {
  if (!AVATAR_MIME_TYPES.includes(file.type)) throw new Error('Použi obrázok vo formáte JPG, PNG alebo WebP.')
  if (file.size > MAX_AVATAR_SIZE) throw new Error('Fotografia môže mať najviac 5 MB.')

  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!user?.email) throw new Error('Prihláseného používateľa sa nepodarilo overiť.')

  const { data: currentProfile, error: currentError } = await supabase
    .from('proffiles').select('id, avatar_url').eq('email', user.email).maybeSingle()
  if (currentError) throw currentError
  if (!currentProfile) throw new Error('Profil používateľa sa nenašiel.')
  const previous = currentProfile.avatar_url ? ownedAvatarTarget(supabase, user.id, currentProfile.avatar_url) : null
  const storagePath = `${user.id}/avatar-${crypto.randomUUID()}`
  const { data: uploadedFile, error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', contentType: file.type, upsert: false })
  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(uploadedFile.path)
  let update = supabase
    .from('proffiles')
    .update({ avatar_url: publicUrl })
    .eq('id', currentProfile.id)
  update = currentProfile.avatar_url === null
    ? update.is('avatar_url', null)
    : update.eq('avatar_url', currentProfile.avatar_url)
  const { data: profile, error: profileError } = await update.select('id').maybeSingle()
  if (profileError) {
    throw new Error('Uloženie fotografie do profilu sa nepodarilo potvrdiť. Obnov stránku a skontroluj fotografiu; ak problém pretrváva, kontaktuj správcu.', { cause: profileError })
  }
  if (!profile) {
    try {
      const { data: removed, error: cleanupError } = await supabase.storage.from(AVATAR_BUCKET).remove([storagePath])
      if (cleanupError) throw cleanupError
      if (!removed?.length) throw new Error('Nový súbor nebol odstránený.')
    } catch (cleanupError) {
      console.error('Odstránenie neuloženej profilovej fotografie zlyhalo:', cleanupError)
      throw new Error('Profil sa nepodarilo aktualizovať a novú fotografiu sa nepodarilo odstrániť z úložiska. Kontaktuj správcu.', { cause: cleanupError })
    }
    throw new Error('Profilová fotografia sa medzitým zmenila. Obnov stránku a skús to znova.')
  }

  let cleanupWarning = false
  if (previous) {
    try {
      const { data: removed, error } = await supabase.storage.from(previous.bucket).remove([previous.path])
      if (error) throw error
      if (!removed?.length) throw new Error('Súbor sa nenašiel alebo nebol odstránený.')
    } catch (error) {
      console.error('Odstránenie predchádzajúcej profilovej fotografie zlyhalo:', error)
      cleanupWarning = true
    }
  }
  return { url: publicUrl, cleanupWarning }
}

export async function removeProfileAvatar(): Promise<void> {
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!user?.email) throw new Error('Prihláseného používateľa sa nepodarilo overiť.')

  const { data: profile, error: profileError } = await supabase
    .from('proffiles')
    .select('id, avatar_url')
    .eq('email', user.email)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile) throw new Error('Profil používateľa sa nenašiel.')
  if (!profile.avatar_url) throw new Error('Profilová fotografia sa už v profile nenachádza.')

  const target = ownedAvatarTarget(supabase, user.id, profile.avatar_url)
  if (!target) throw new Error('Fotografia nie je v podporovanom úložisku a nedá sa bezpečne odstrániť.')

  const storage = supabase.storage.from(target.bucket)
  const parts = target.path.split('/')
  const name = parts.pop()!
  const folder = parts.join('/')
  async function photoExists(): Promise<boolean> {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await storage.list(folder, { search: name, limit: 100, offset })
      if (error) throw error
      if (!data) throw new Error('Fotografiu v úložisku sa nepodarilo overiť.')
      if (data.some((entry) => entry.name === name && entry.id !== null)) return true
      if (data.length < 100) return false
    }
  }

  if (!await photoExists()) {
    throw new Error('Fotografiu v úložisku sa nepodarilo nájsť alebo k nej nemáš prístup. Skontroluj oprávnenia úložiska.')
  }
  const { data: removed, error: removalError } = await storage.remove([target.path])
  if (removalError) throw removalError
  if (!removed?.length || await photoExists()) throw new Error('Fotografiu sa nepodarilo odstrániť z úložiska. Skontroluj oprávnenia.')

  const { data: updated, error: updateError } = await supabase
    .from('proffiles')
    .update({ avatar_url: null })
    .eq('id', profile.id)
    .eq('avatar_url', profile.avatar_url)
    .select('id')
    .maybeSingle()
  if (updateError) throw new Error('Fotografia bola odstránená z úložiska, ale profil sa nepodarilo aktualizovať. Kontaktuj správcu.', { cause: updateError })
  if (!updated) throw new Error('Profilová fotografia sa medzitým zmenila. Obnov stránku a skús to znova.')
}
