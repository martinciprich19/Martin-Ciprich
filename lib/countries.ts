export type CountryCode = 'SK' | 'NL'
export type AppLanguage = 'sk' | 'en' | 'nl'

export const SUPPORTED_COUNTRIES = [
  { code: 'SK', name: 'Slovensko' },
  { code: 'NL', name: 'Nederland' },
] as const

export const COUNTRY_DEFAULT_LANGUAGE: Record<CountryCode, AppLanguage> = { SK: 'sk', NL: 'nl' }

export const SUBDIVISIONS = {
  SK: [
    { code: 'SK-BL', name: 'Bratislavský kraj' },
    { code: 'SK-TA', name: 'Trnavský kraj' },
    { code: 'SK-TC', name: 'Trenčiansky kraj' },
    { code: 'SK-NI', name: 'Nitriansky kraj' },
    { code: 'SK-ZI', name: 'Žilinský kraj' },
    { code: 'SK-BC', name: 'Banskobystrický kraj' },
    { code: 'SK-PV', name: 'Prešovský kraj' },
    { code: 'SK-KI', name: 'Košický kraj' },
  ],
  NL: [
    { code: 'NL-DR', name: 'Drenthe' },
    { code: 'NL-FL', name: 'Flevoland' },
    { code: 'NL-FR', name: 'Fryslân' },
    { code: 'NL-GE', name: 'Gelderland' },
    { code: 'NL-GR', name: 'Groningen' },
    { code: 'NL-LI', name: 'Limburg' },
    { code: 'NL-NB', name: 'Noord-Brabant' },
    { code: 'NL-NH', name: 'Noord-Holland' },
    { code: 'NL-OV', name: 'Overijssel' },
    { code: 'NL-UT', name: 'Utrecht' },
    { code: 'NL-ZE', name: 'Zeeland' },
    { code: 'NL-ZH', name: 'Zuid-Holland' },
  ],
} as const

export function isCountryCode(value: unknown): value is CountryCode {
  return value === 'SK' || value === 'NL'
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'sk' || value === 'en' || value === 'nl'
}

export function regionsForCountry(country: CountryCode): string[] {
  return SUBDIVISIONS[country].map((subdivision) => subdivision.name)
}

export function subdivisionCode(country: CountryCode, region: string): string | null {
  return SUBDIVISIONS[country].find((subdivision) => subdivision.name === region)?.code ?? null
}

export function browserCountry(languages: readonly string[]): CountryCode {
  return languages.some((language) => /^nl(?:-|$)/i.test(language)) ? 'NL' : 'SK'
}
