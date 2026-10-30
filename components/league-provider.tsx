'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { browserCountry, isCountryCode, regionsForCountry, type CountryCode } from '@/lib/countries'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import { useLanguage } from '@/components/language-provider'

type LeagueContextValue = {
  country: CountryCode
  setCountry: (country: CountryCode) => void
  profileCountry: CountryCode | null
  regions: string[]
  isLoading: boolean
}

const LeagueContext = createContext<LeagueContextValue | null>(null)

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const [country, setCountryState] = useState<CountryCode>('SK')
  const [profileCountry, setProfileCountry] = useState<CountryCode | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const { t } = useLanguage()

  const setCountry = useCallback((next: CountryCode) => {
    setCountryState(next)
    try {
      window.localStorage.setItem('riva-browsing-country', next)
    } catch (storageError: unknown) {
      console.error('Uloženie národnej ligy zlyhalo:', getErrorMessage(storageError, 'Neznáma chyba.'))
      setError('Výber ligy sa nepodarilo uložiť do zariadenia.')
    }
  }, [])

  useEffect(() => {
    let initialCountry = browserCountry(navigator.languages)
    try {
      const stored = window.localStorage.getItem('riva-browsing-country')
      if (isCountryCode(stored)) initialCountry = stored
    } catch (storageError: unknown) {
      console.error('Načítanie uloženej ligy zlyhalo:', getErrorMessage(storageError, 'Neznáma chyba.'))
      setError('Výber ligy sa nepodarilo načítať zo zariadenia.')
    }
    setCountryState(initialCountry)
    const supabase = createClient()
    let active = true
    let revision = 0
    let previousUser: string | null | undefined

    async function loadCountry(user: { id: string; email?: string } | null) {
      if (previousUser !== undefined && previousUser === (user?.id ?? null)) return
      previousUser = user?.id ?? null
      const current = ++revision
      if (!user?.email) {
        if (active) { setProfileCountry(null); setIsLoading(false); setError('') }
        return
      }
      if (active) { setProfileCountry(null); setIsLoading(true) }
      try {
        const { data, error: loadError } = await supabase.from('proffiles')
          .select('country_code').eq('email', user.email).maybeSingle()
        if (loadError) throw loadError
        if (!data || !isCountryCode(data.country_code)) throw new Error('Účet nemá platnú národnú ligu.')
        if (!active || current !== revision) return
        setProfileCountry(data.country_code)
        // A new sign-in starts in the member's league, not another device's last directory.
        setCountry(data.country_code)
        setError('')
      } catch (loadError: unknown) {
        console.error('Načítanie národnej ligy zlyhalo:', getErrorMessage(loadError, 'Neznáma chyba.'))
        if (active && current === revision) setError('Národnú ligu sa nepodarilo načítať. Obnov stránku.')
      } finally {
        if (active && current === revision) setIsLoading(false)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase auth callbacks must not await further client operations.
      window.setTimeout(() => { if (active) void loadCountry(session?.user ?? null) }, 0)
    })
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (authError && authError.name !== 'AuthSessionMissingError') {
        console.error('Overenie národnej ligy zlyhalo:', authError.message)
      }
      if (active && previousUser === undefined) void loadCountry(data.user)
    }).catch((authError: unknown) => {
      console.error('Overenie národnej ligy zlyhalo:', getErrorMessage(authError, 'Neznáma chyba.'))
      if (active) { setError('Národnú ligu sa nepodarilo načítať. Obnov stránku.'); setIsLoading(false) }
    })
    return () => { active = false; revision++; subscription.unsubscribe() }
  }, [setCountry])

  const value = useMemo(() => ({ country, setCountry, profileCountry, regions: regionsForCountry(country), isLoading }), [country, setCountry, profileCountry, isLoading])
  return (
    <LeagueContext.Provider value={value}>
      {error ? <p role="alert" className="relative z-50 bg-app-panel p-3 text-center text-sm text-app-red-300">{t(error, 'Could not load your national league. Reload the page.')}</p> : null}
      {children}
    </LeagueContext.Provider>
  )
}

export function useLeague() {
  const context = useContext(LeagueContext)
  if (!context) throw new Error('useLeague must be used inside LeagueProvider')
  return context
}
