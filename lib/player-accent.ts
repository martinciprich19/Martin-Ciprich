import type { Gender } from '@/lib/profiles'

export function playerAccentColor(gender: Gender | null | undefined): string {
  return gender === 'female' ? '#f472b6' : '#ccff00'
}
