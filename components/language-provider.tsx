'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { pairChallengeTranslations } from '@/lib/i18n/pair-challenge-translations'
import { arenaTranslations } from '@/lib/i18n/arena-translations'
import { playerTranslations } from '@/lib/i18n/players-translations'
import { createTranslator, startDomTranslation } from '@/lib/i18n/dom-translator'

export type Language = 'sk' | 'en'

type Dictionary = Record<string, string>

export const translations: Record<Language, Dictionary> = {
  sk: {
    ...pairChallengeTranslations.sk,
    ...arenaTranslations.sk,
    ...playerTranslations.sk,
    'Prehľad': 'Prehľad', 'Môj profil': 'Môj profil', 'Rebríčky': 'Rebríčky', 'Nájsť súperov': 'Nájsť súperov', 'Výzvy': 'Výzvy', 'Zápasy': 'Zápasy', 'Turnaje': 'Turnaje', 'Arény': 'Arény', 'Správy': 'Správy', 'Nastavenia': 'Nastavenia',
    'Overview': 'Prehľad', 'My profile': 'Môj profil', 'Leaderboards': 'Rebríčky', 'Find opponents': 'Nájsť súperov', 'Challenges': 'Výzvy', 'Matches': 'Zápasy', 'Tournaments': 'Turnaje', 'Arenas': 'Arény', 'Messages': 'Správy', 'Settings': 'Nastavenia',
    'Uložiť zmeny': 'Uložiť zmeny', 'Save changes': 'Uložiť zmeny', 'Jazyk aplikácie': 'Jazyk aplikácie', 'Application language': 'Jazyk aplikácie', 'Slovenčina': 'Slovenčina', 'English': 'English',
    'Spravuj svoj profil, súkromie a herné preferencie.': 'Spravuj svoj profil, súkromie a herné preferencie.', 'Manage your profile, privacy, and game preferences.': 'Spravuj svoj profil, súkromie a herné preferencie.',
    'Hráčsky profil & údaje': 'Hráčsky profil & údaje', 'Notifikácie & upozornenia': 'Notifikácie & upozornenia', 'Súkromie & viditeľnosť': 'Súkromie & viditeľnosť', 'Kluby & dostupnosť': 'Kluby & dostupnosť', 'Zabezpečenie & účet': 'Zabezpečenie & účet',
    'Player profile & details': 'Hráčsky profil & údaje', 'Notifications & alerts': 'Notifikácie & upozornenia', 'Privacy & visibility': 'Súkromie & viditeľnosť', 'Clubs & availability': 'Kluby & dostupnosť', 'Security & account': 'Zabezpečenie & účet',
    'Odhlásiť sa': 'Odhlásiť sa', 'Log out': 'Odhlásiť sa', 'Vitaj späť v SPL': 'Vitaj späť v SPL', 'Tieto údaje sa zobrazia súperom v SPL.': 'Tieto údaje sa zobrazia súperom v SPL.', 'Zobrazované meno': 'Zobrazované meno', 'E-mail': 'E-mail', 'Telefónne číslo': 'Telefónne číslo', 'Značka rakety': 'Značka rakety', 'Preferovaná strana': 'Preferovaná strana', 'Dominantná ruka': 'Dominantná ruka', 'Krátky profilový popis / Bio': 'Krátky profilový popis / Bio', 'Zobraziť moje zápasy': 'Zobraziť moje zápasy', 'Najbližšie': 'Najbližšie', 'Nasledujúce zápasy': 'Nasledujúce zápasy', 'Nedávne zápasy': 'Nedávne zápasy', 'Žiadne zápasy': 'Žiadne zápasy', 'Ako to funguje': 'Ako to funguje', 'Prihlásiť sa': 'Prihlásiť sa', 'Registrovať sa': 'Registrovať sa', 'Zavrieť': 'Zavrieť', 'Otvoriť menu': 'Otvoriť menu', 'SPL domov': 'SPL domov', 'Slovenská padelová liga': 'Slovenská padelová liga', 'Hraj.': 'Hraj.', 'Vyzývaj.': 'Vyzývaj.', 'Zlepšuj sa.': 'Zlepšuj sa.', 'Staň sa najlepším.': 'Staň sa najlepším.', 'Stať sa členom': 'Stať sa členom', 'Slovak Padel League je celoslovenská liga hráčov v padeli. Zbieraj body, zlepšuj svoj rebríček, vyzývaj súperov a hraj o skvelé ceny.': 'Slovak Padel League je celoslovenská liga hráčov v padeli. Zbieraj body, zlepšuj svoj rebríček, vyzývaj súperov a hraj o skvelé ceny.', 'SPL — Slovak Padel League': 'SPL — Slovak Padel League', 'Späť na prehľad': 'Späť na prehľad', 'Poradie hráčov podľa dynamického ELO ratingu.': 'Poradie hráčov podľa dynamického ELO ratingu.', 'Celoslovenský rebríček': 'Celoslovenský rebríček', 'Krajský rebríček': 'Krajský rebríček', 'Hľadať hráča...': 'Hľadať hráča...', 'Všetky kraje': 'Všetky kraje', 'Aktualizované po potvrdení zápasu': 'Aktualizované po potvrdení zápasu', 'Pozícia': 'Pozícia', 'HRÁČ': 'HRÁČ', 'Kraj': 'Kraj', 'ELO Rating': 'ELO Rating', 'Odohrané zápasy': 'Odohrané zápasy', 'Vyzvať': 'Vyzvať',
  },
  en: {
    ...pairChallengeTranslations.en,
    ...arenaTranslations.en,
    ...playerTranslations.en,
    'Prehľad': 'Overview', 'Môj profil': 'My profile', 'Rebríčky': 'Leaderboards', 'Nájsť súperov': 'Find opponents', 'Výzvy': 'Challenges', 'Zápasy': 'Matches', 'Turnaje': 'Tournaments', 'Arény': 'Arenas', 'Správy': 'Messages', 'Nastavenia': 'Settings',
    'Overview': 'Overview', 'My profile': 'My profile', 'Leaderboards': 'Leaderboards', 'Find opponents': 'Find opponents', 'Challenges': 'Challenges', 'Matches': 'Matches', 'Tournaments': 'Tournaments', 'Arenas': 'Arenas', 'Messages': 'Messages', 'Settings': 'Settings',
    'Uložiť zmeny': 'Save changes', 'Save changes': 'Save changes', 'Jazyk aplikácie': 'Application language', 'Application language': 'Application language', 'Slovenčina': 'Slovak', 'English': 'English',
    'Spravuj svoj profil, súkromie a herné preferencie.': 'Manage your profile, privacy, and game preferences.', 'Manage your profile, privacy, and game preferences.': 'Manage your profile, privacy, and game preferences.',
    'Hráčsky profil & údaje': 'Player profile & details', 'Notifikácie & upozornenia': 'Notifications & alerts', 'Súkromie & viditeľnosť': 'Privacy & visibility', 'Kluby & dostupnosť': 'Clubs & availability', 'Zabezpečenie & účet': 'Security & account',
    'Player profile & details': 'Player profile & details', 'Notifications & alerts': 'Notifications & alerts', 'Privacy & visibility': 'Privacy & visibility', 'Clubs & availability': 'Clubs & availability', 'Security & account': 'Security & account',
    'Odhlásiť sa': 'Log out', 'Log out': 'Log out', 'Vitaj späť v SPL': 'Welcome back to SPL', 'Tieto údaje sa zobrazia súperom v SPL.': 'These details are visible to opponents in SPL.', 'Zobrazované meno': 'Display name', 'E-mail': 'Email', 'Telefónne číslo': 'Phone number', 'Značka rakety': 'Racket brand', 'Preferovaná strana': 'Preferred side', 'Dominantná ruka': 'Dominant hand', 'Krátky profilový popis / Bio': 'Short profile bio', 'Zobraziť moje zápasy': 'View my matches', 'Najbližšie': 'Upcoming', 'Nasledujúce zápasy': 'Upcoming matches', 'Nedávne zápasy': 'Recent matches', 'Žiadne zápasy': 'No matches', 'Ako to funguje': 'How it works', 'Prihlásiť sa': 'Log in', 'Registrovať sa': 'Sign up', 'Zavrieť': 'Close', 'Otvoriť menu': 'Open menu', 'SPL domov': 'SPL home', 'Slovenská padelová liga': 'Slovak padel league', 'Hraj.': 'Play.', 'Vyzývaj.': 'Challenge.', 'Zlepšuj sa.': 'Improve.', 'Staň sa najlepším.': 'Become the best.', 'Stať sa členom': 'Join the league', 'Slovak Padel League je celoslovenská liga hráčov v padeli. Zbieraj body, zlepšuj svoj rebríček, vyzývaj súperov a hraj o skvelé ceny.': 'Slovak Padel League is a nationwide padel league. Earn points, climb the rankings, challenge opponents and play for great prizes.', 'SPL — Slovak Padel League': 'SPL — Slovak Padel League', 'Späť na prehľad': 'Back to overview', 'Poradie hráčov podľa dynamického ELO ratingu.': 'Players ranked by dynamic ELO rating.', 'Celoslovenský rebríček': 'National ranking', 'Krajský rebríček': 'Regional ranking', 'Hľadať hráča...': 'Search player...', 'Všetky kraje': 'All regions', 'Aktualizované po potvrdení zápasu': 'Updated after match confirmation', 'Pozícia': 'Position', 'HRÁČ': 'PLAYER', 'Kraj': 'Region', 'ELO Rating': 'ELO rating', 'Odohrané zápasy': 'Matches played', 'Vyzvať': 'Challenge',
  },
}

type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: (key: string, englishFallback?: string) => string }
const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('sk')
  const hasLoadedStoredLanguage = useRef(false)

  useEffect(() => {
    const saved = window.localStorage.getItem('spl-language')
    if (saved === 'en') setLanguageState('en')
    hasLoadedStoredLanguage.current = true
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
    if (hasLoadedStoredLanguage.current) window.localStorage.setItem('spl-language', language)
  }, [language])

  const setLanguage = (next: Language) => setLanguageState(next)

  // Components that still render hardcoded Slovak text are translated in the DOM while English is active.
  useEffect(() => {
    if (language !== 'en') return
    const reverse: Record<string, string> = {}
    for (const [key, slovak] of Object.entries(translations.sk)) {
      const english = translations.en[key]
      if (english) reverse[slovak] = english
    }
    const { translateString } = createTranslator(reverse)
    const stop = startDomTranslation(translateString)
    const originalAlert = window.alert
    window.alert = (message?: unknown) => originalAlert.call(window, translateString(String(message ?? '')) ?? String(message ?? ''))
    return () => {
      stop()
      window.alert = originalAlert
    }
  }, [language])
  const value = useMemo(() => ({ language, setLanguage, t: (key: string, englishFallback?: string) => translations[language][key] ?? (language === 'en' ? englishFallback ?? key : key) }), [language])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}

export function translate(language: Language, key: string, englishFallback?: string) {
  return translations[language][key] ?? (language === 'en' ? englishFallback ?? key : key)
}
