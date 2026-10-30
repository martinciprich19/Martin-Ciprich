import type { AppLanguage } from '@/lib/countries'

export type { AppLanguage }

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'sk' || value === 'en' || value === 'nl'
}

export function browserLanguage(languages: readonly string[]): AppLanguage {
  for (const locale of languages) {
    const language = locale.toLowerCase().split(/[-_]/)[0]
    if (isAppLanguage(language)) return language
  }
  return 'sk'
}
