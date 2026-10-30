'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { pairChallengeTranslations } from '@/lib/i18n/pair-challenge-translations'
import { arenaTranslations } from '@/lib/i18n/arena-translations'
import { playerTranslations } from '@/lib/i18n/players-translations'
import { createTranslator, startDomTranslation } from '@/lib/i18n/dom-translator'
import { uiTranslations } from '@/lib/i18n/ui-translations'
import { dutchDictionary, dutchVocabulary } from '@/lib/i18n/dutch-translations'
import { authTranslations } from '@/lib/i18n/auth-translations'
import { browserLanguage, isAppLanguage, type AppLanguage } from '@/lib/i18n/language'
import { createClient } from '@/lib/supabase/client'
import { sportDutch } from '@/lib/i18n/sport-dutch'
import { sharedDutch } from '@/lib/i18n/shared-dutch'

export type Language = AppLanguage

type Dictionary = Record<string, string>

export const translations: Record<Language, Dictionary> = {
  sk: {
    ...pairChallengeTranslations.sk,
    ...arenaTranslations.sk,
    ...playerTranslations.sk,
    ...authTranslations.sk,
    'Prehľad': 'Prehľad', 'Môj profil': 'Môj profil', 'Prebiehajúce zápasy': 'Prebiehajúce zápasy', 'Rebríčky': 'Rebríčky', 'Nájsť súperov': 'Nájsť súperov', 'Výzvy': 'Výzvy', 'Zápasy': 'Zápasy', 'Turnaje': 'Turnaje', 'Arény': 'Arény', 'Správy': 'Správy', 'Nastavenia': 'Nastavenia',
    'Overview': 'Prehľad', 'My profile': 'Môj profil', 'Live matches': 'Prebiehajúce zápasy', 'Leaderboards': 'Rebríčky', 'Find opponents': 'Nájsť súperov', 'Challenges': 'Výzvy', 'Matches': 'Zápasy', 'Tournaments': 'Turnaje', 'Arenas': 'Arény', 'Messages': 'Správy', 'Settings': 'Nastavenia',
    'Uložiť zmeny': 'Uložiť zmeny', 'Save changes': 'Uložiť zmeny', 'Jazyk aplikácie': 'Jazyk aplikácie', 'Application language': 'Jazyk aplikácie', 'Slovenčina': 'Slovenčina', 'English': 'English',
    'Spravuj svoj profil, súkromie a herné preferencie.': 'Spravuj svoj profil, súkromie a herné preferencie.', 'Manage your profile, privacy, and game preferences.': 'Spravuj svoj profil, súkromie a herné preferencie.',
    'Hráčsky profil & údaje': 'Hráčsky profil & údaje', 'Notifikácie & upozornenia': 'Notifikácie & upozornenia', 'Súkromie & viditeľnosť': 'Súkromie & viditeľnosť', 'Kluby & dostupnosť': 'Kluby & dostupnosť', 'Zabezpečenie & účet': 'Zabezpečenie & účet',
    'Player profile & details': 'Hráčsky profil & údaje', 'Notifications & alerts': 'Notifikácie & upozornenia', 'Privacy & visibility': 'Súkromie & viditeľnosť', 'Clubs & availability': 'Kluby & dostupnosť', 'Security & account': 'Zabezpečenie & účet',
    'Odhlásiť sa': 'Odhlásiť sa', 'Log out': 'Odhlásiť sa', 'Vitaj späť v RIVA Padel': 'Vitaj späť v RIVA Padel', 'Tieto údaje sa zobrazia súperom v RIVA Padel.': 'Tieto údaje sa zobrazia súperom v RIVA Padel.', 'Zobrazované meno': 'Zobrazované meno', 'E-mail': 'E-mail', 'Telefónne číslo': 'Telefónne číslo', 'Značka rakety': 'Značka rakety', 'Preferovaná strana': 'Preferovaná strana', 'Dominantná ruka': 'Dominantná ruka', 'Krátky profilový popis / Bio': 'Krátky profilový popis / Bio', 'Zobraziť moje zápasy': 'Zobraziť moje zápasy', 'Najbližšie': 'Najbližšie', 'Nasledujúce zápasy': 'Nasledujúce zápasy', 'Nedávne zápasy': 'Nedávne zápasy', 'Žiadne zápasy': 'Žiadne zápasy', 'Ako to funguje': 'Ako to funguje', 'Prihlásiť sa': 'Prihlásiť sa', 'Registrovať sa': 'Registrovať sa', 'Zavrieť': 'Zavrieť', 'Otvoriť menu': 'Otvoriť menu', 'RIVA Padel domov': 'RIVA Padel domov', 'RIVA Padel': 'RIVA Padel', 'Hraj.': 'Hraj.', 'Vyzývaj.': 'Vyzývaj.', 'Zlepšuj sa.': 'Zlepšuj sa.', 'Staň sa najlepším.': 'Staň sa najlepším.', 'Stať sa členom': 'Stať sa členom', 'RIVA Padel je aplikácia pre padelových hráčov. Zbieraj body, zlepšuj svoj rebríček, vyzývaj súperov a hraj o skvelé ceny.': 'RIVA Padel je aplikácia pre padelových hráčov. Zbieraj body, zlepšuj svoj rebríček, vyzývaj súperov a hraj o skvelé ceny.', 'Späť na prehľad': 'Späť na prehľad', 'Poradie hráčov podľa dynamického ELO ratingu.': 'Poradie hráčov podľa dynamického ELO ratingu.', 'Celoslovenský rebríček': 'Celoslovenský rebríček', 'Krajský rebríček': 'Krajský rebríček', 'Hľadať hráča...': 'Hľadať hráča...', 'Všetky kraje': 'Všetky kraje', 'Aktualizované po potvrdení zápasu': 'Aktualizované po potvrdení zápasu', 'Pozícia': 'Pozícia', 'HRÁČ': 'HRÁČ', 'Kraj': 'Kraj', 'ELO Rating': 'ELO Rating', 'Odohrané zápasy': 'Odohrané zápasy', 'Vyzvať': 'Vyzvať',
  },
  en: {
    ...pairChallengeTranslations.en,
    ...arenaTranslations.en,
    ...playerTranslations.en,
    ...authTranslations.en,
    'Prehľad': 'Overview', 'Môj profil': 'My profile', 'Prebiehajúce zápasy': 'Live matches', 'Rebríčky': 'Leaderboards', 'Nájsť súperov': 'Find opponents', 'Výzvy': 'Challenges', 'Zápasy': 'Matches', 'Turnaje': 'Tournaments', 'Arény': 'Arenas', 'Správy': 'Messages', 'Nastavenia': 'Settings',
    'Overview': 'Overview', 'My profile': 'My profile', 'Live matches': 'Live matches', 'Leaderboards': 'Leaderboards', 'Find opponents': 'Find opponents', 'Challenges': 'Challenges', 'Matches': 'Matches', 'Tournaments': 'Tournaments', 'Arenas': 'Arenas', 'Messages': 'Messages', 'Settings': 'Settings',
    'Uložiť zmeny': 'Save changes', 'Save changes': 'Save changes', 'Jazyk aplikácie': 'Application language', 'Application language': 'Application language', 'Slovenčina': 'Slovak', 'English': 'English',
    'Spravuj svoj profil, súkromie a herné preferencie.': 'Manage your profile, privacy, and game preferences.', 'Manage your profile, privacy, and game preferences.': 'Manage your profile, privacy, and game preferences.',
    'Hráčsky profil & údaje': 'Player profile & details', 'Notifikácie & upozornenia': 'Notifications & alerts', 'Súkromie & viditeľnosť': 'Privacy & visibility', 'Kluby & dostupnosť': 'Clubs & availability', 'Zabezpečenie & účet': 'Security & account',
    'Player profile & details': 'Player profile & details', 'Notifications & alerts': 'Notifications & alerts', 'Privacy & visibility': 'Privacy & visibility', 'Clubs & availability': 'Clubs & availability', 'Security & account': 'Security & account',
    'Odhlásiť sa': 'Log out', 'Log out': 'Log out', 'Vitaj späť v RIVA Padel': 'Welcome back to RIVA Padel', 'Tieto údaje sa zobrazia súperom v RIVA Padel.': 'These details are visible to opponents in RIVA Padel.', 'Zobrazované meno': 'Display name', 'E-mail': 'Email', 'Telefónne číslo': 'Phone number', 'Značka rakety': 'Racket brand', 'Preferovaná strana': 'Preferred side', 'Dominantná ruka': 'Dominant hand', 'Krátky profilový popis / Bio': 'Short profile bio', 'Zobraziť moje zápasy': 'View my matches', 'Najbližšie': 'Upcoming', 'Nasledujúce zápasy': 'Upcoming matches', 'Nedávne zápasy': 'Recent matches', 'Žiadne zápasy': 'No matches', 'Ako to funguje': 'How it works', 'Prihlásiť sa': 'Log in', 'Registrovať sa': 'Sign up', 'Zavrieť': 'Close', 'Otvoriť menu': 'Open menu', 'RIVA Padel domov': 'RIVA Padel home', 'RIVA Padel': 'RIVA Padel', 'Hraj.': 'Play.', 'Vyzývaj.': 'Challenge.', 'Zlepšuj sa.': 'Improve.', 'Staň sa najlepším.': 'Become the best.', 'Stať sa členom': 'Join the league', 'RIVA Padel je aplikácia pre padelových hráčov. Zbieraj body, zlepšuj svoj rebríček, vyzývaj súperov a hraj o skvelé ceny.': 'RIVA Padel is an app for padel players. Earn points, climb the rankings, challenge opponents and play for great prizes.', 'Späť na prehľad': 'Back to overview', 'Poradie hráčov podľa dynamického ELO ratingu.': 'Players ranked by dynamic ELO rating.', 'Celoslovenský rebríček': 'National ranking', 'Krajský rebríček': 'Regional ranking', 'Hľadať hráča...': 'Search player...', 'Všetky kraje': 'All regions', 'Aktualizované po potvrdení zápasu': 'Updated after match confirmation', 'Pozícia': 'Position', 'HRÁČ': 'PLAYER', 'Kraj': 'Region', 'ELO Rating': 'ELO rating', 'Odohrané zápasy': 'Matches played', 'Vyzvať': 'Challenge',
  },
  nl: {},
}

translations.nl = {
  ...dutchVocabulary,
  ...dutchDictionary(translations.en),
  ...dutchDictionary(uiTranslations),
  ...authTranslations.nl,
  ...sportDutch,
  ...sharedDutch,
  'Nederlands': 'Nederlands',
}
translations.sk.Nederlands = 'Holandčina'
translations.en.Nederlands = 'Dutch'
const translators = {
  sk: createTranslator({}, 'sk'),
  en: createTranslator(translations.en, 'en'),
  nl: createTranslator(translations.nl, 'nl'),
}

type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: (key: string, englishFallback?: string) => string }
const LanguageContext = createContext<LanguageContextValue | null>(null)

function isMissingAuthSession(error: unknown): boolean {
  return error !== null && typeof error === 'object'
    && (('name' in error && error.name === 'AuthSessionMissingError')
      || ('code' in error && error.code === 'session_not_found'))
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('sk')
  const manualRevision = useRef(0)
  const currentLanguage = useRef<Language>('sk')
  const profileEmail = useRef<string | null>(null)
  const client = useRef<ReturnType<typeof createClient> | null>(null)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())

  const applyLanguage = useCallback((next: Language) => {
    currentLanguage.current = next
    setLanguageState(next)
    try {
      window.localStorage.setItem('spl-language', next)
    } catch (error) {
      console.warn('Could not save the application language locally.', error)
    }
  }, [])

  const persistLanguage = useCallback((email: string, next: Language) => {
    const supabase = client.current
    if (!supabase) return
    writeQueue.current = writeQueue.current.then(async () => {
      // Do not write to a previous account after an authentication change.
      if (profileEmail.current !== email) return
      const { error } = await supabase.from('proffiles').update({ preferred_language: next }).eq('email', email)
      if (error) throw error
    }).catch((error: unknown) => {
      console.warn('Could not save the preferred language to the player profile.', error)
    })
  }, [])

  const setLanguage = useCallback((next: Language) => {
    if (!isAppLanguage(next)) return
    manualRevision.current += 1
    applyLanguage(next)
    if (profileEmail.current) persistLanguage(profileEmail.current, next)
  }, [applyLanguage, persistLanguage])

  useEffect(() => {
    let active = true
    let request = 0
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let unsubscribe: (() => void) | undefined
    const initialRevision = manualRevision.current
    let preferred = browserLanguage(navigator.languages?.length ? navigator.languages : [navigator.language])
    try {
      const saved = window.localStorage.getItem('spl-language')
      if (isAppLanguage(saved)) preferred = saved
    } catch (error) {
      console.warn('Could not read the saved application language.', error)
    }
    if (initialRevision === 0) applyLanguage(preferred)

    async function loadProfile(email: string | null, revision: number, version: number) {
      if (!active || version !== request) return
      profileEmail.current = email
      if (!email || !client.current) return
      if (manualRevision.current !== revision || manualRevision.current > 0) {
        persistLanguage(email, currentLanguage.current)
        return
      }
      try {
        const { data, error } = await client.current.from('proffiles').select('preferred_language').eq('email', email).maybeSingle()
        if (error) throw error
        if (active && version === request && manualRevision.current === revision && isAppLanguage(data?.preferred_language)) {
          applyLanguage(data.preferred_language)
        }
      } catch (error) {
        if (active) console.warn('Could not load the preferred language from the player profile.', error)
      }
    }

    try {
      const supabase = createClient()
      client.current = supabase
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        const version = ++request
        const email = session?.user.email ?? null
        if (profileEmail.current && profileEmail.current !== email) manualRevision.current = 0
        const revision = manualRevision.current
        profileEmail.current = email
        // Supabase auth callbacks run under its lock: never await another Supabase call here.
        const timer = setTimeout(() => {
          timers.delete(timer)
          void loadProfile(email, revision, version)
        }, 0)
        timers.add(timer)
      })
      unsubscribe = () => subscription.unsubscribe()
      const version = request
      void supabase.auth.getUser().then(({ data, error }) => {
        if (error) {
          if (active && !isMissingAuthSession(error)) console.warn('Could not resolve the authenticated language preference.', error)
          return
        }
        return loadProfile(data.user?.email ?? null, initialRevision, version)
      }).catch((error: unknown) => {
        if (active && !isMissingAuthSession(error)) console.warn('Could not resolve the authenticated language preference.', error)
      })
    } catch (error) {
      console.warn('Could not initialize profile language preferences.', error)
    }
    return () => {
      active = false
      request += 1
      timers.forEach(clearTimeout)
      unsubscribe?.()
      profileEmail.current = null
      client.current = null
    }
  }, [applyLanguage, persistLanguage])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  // Legacy surfaces still render Slovak. Restore their source when changing languages.
  useEffect(() => {
    if (language === 'sk') return
    const reverse: Record<string, string> = {}
    for (const [key, slovak] of Object.entries(translations.sk)) {
      const localized = translations[language][key]
      if (localized) reverse[slovak] = localized
    }
    const { translateString } = createTranslator({ ...translations[language], ...reverse }, language)
    const stop = startDomTranslation(translateString)
    const originalAlert = window.alert
    window.alert = (message?: unknown) => originalAlert.call(window, translateString(String(message ?? '')) ?? String(message ?? ''))
    return () => {
      stop()
      window.alert = originalAlert
    }
  }, [language])
  const value = useMemo(() => ({ language, setLanguage, t: (key: string, englishFallback?: string) => translate(language, key, englishFallback) }), [language, setLanguage])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}

export function translate(language: Language, key: string, englishFallback?: string) {
  return translations[language][key] ?? (language === 'sk' ? key : translators[language].translateString(key) ?? (language === 'en' ? englishFallback ?? key : key))
}
