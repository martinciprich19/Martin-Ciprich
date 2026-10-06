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
    .update({ avatar_url: null })
    .eq('email', user.email)
    .select('id')
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile) throw new Error('Profil používateľa sa nenašiel.')

  const { error: storageError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .remove([`${user.id}/avatar`])
  if (storageError) throw storageError
}
