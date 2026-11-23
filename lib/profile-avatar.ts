import { createClient } from '@/lib/supabase/client'

const AVATAR_BUCKET = 'avatars'
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_AVATAR_SIZE = 5 * 1024 * 1024

export async function saveProfileAvatar(file: File): Promise<string> {
  if (!AVATAR_MIME_TYPES.includes(file.type)) throw new Error('Použi obrázok vo formáte JPG, PNG alebo WebP.')
  if (file.size > MAX_AVATAR_SIZE) throw new Error('Fotografia môže mať najviac 5 MB.')

  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!user?.email) throw new Error('Prihláseného používateľa sa nepodarilo overiť.')

  const storagePath = `${user.id}/avatar`
  const { data: uploadedFile, error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', contentType: file.type, upsert: true })
  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(uploadedFile.path)
  const { data: profile, error: profileError } = await supabase
    .from('proffiles')
    .update({ avatar_url: publicUrl })
    .eq('email', user.email)
    .select('id')
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile) throw new Error('Profil používateľa sa nenašiel.')

  return publicUrl
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

  const avatarUrl = new URL(profile.avatar_url)
  let target: { bucket: string; path: string } | null = null
  for (const bucket of [AVATAR_BUCKET, 'player-avatars']) {
    const base = new URL(supabase.storage.from(bucket).getPublicUrl('').data.publicUrl)
    const prefix = `${base.pathname.replace(/\/+$/, '')}/`
    if (avatarUrl.origin !== base.origin || !avatarUrl.pathname.startsWith(prefix)) continue
    const path = decodeURIComponent(avatarUrl.pathname.slice(prefix.length))
    const parts = path.split('/')
    if (parts[0] !== user.id || parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
      throw new Error('Cesta k profilovej fotografii nie je platná.')
    }
    target = { bucket, path }
    break
  }
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
