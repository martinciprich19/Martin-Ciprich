'use client'

import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { RivaLogo } from '@/components/riva-logo'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetchArenas } from '@/lib/arenas'
import { createPlayerProfile, type DominantHand, type Gender } from '@/lib/profiles'
import { getErrorMessage } from '@/lib/errors'
import { emailRedirectUrl } from '@/lib/auth-redirect'
import { useLanguage } from '@/components/language-provider'
import { useLeague } from '@/components/league-provider'
import { LeagueSelector } from '@/components/league-selector'
import { COUNTRY_DEFAULT_LANGUAGE, isCountryCode, regionsForCountry, subdivisionCode, SUPPORTED_COUNTRIES, type CountryCode } from '@/lib/countries'

export default function SignUpPage() {
  const { language, setLanguage, t } = useLanguage()
  const { country, setCountry } = useLeague()
  const [registrationCountry, setRegistrationCountry] = useState<CountryCode>(country)
  const regions = regionsForCountry(registrationCountry)
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', region: '', level: '', gender: '' as Gender | '', dominantHand: 'right' as DominantHand, homeVenueId: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { data: arenas = [], error: arenasError } = useSWR(['arenas', registrationCountry], () => fetchArenas(registrationCountry))

  useEffect(() => {
    setRegistrationCountry(country)
    setForm((current) => ({ ...current, region: '', homeVenueId: '' }))
  }, [country])

  function chooseCountry(value: string) {
    if (!isCountryCode(value)) return
    setRegistrationCountry(value)
    setCountry(value)
    setLanguage(COUNTRY_DEFAULT_LANGUAGE[value])
    setForm((current) => ({ ...current, region: '', homeVenueId: '' }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!regions.includes(form.region)) {
      setError(t(registrationCountry === 'NL' ? 'Vyber svoju provinciu.' : 'Vyber svoj kraj.'))
      return
    }

    if (form.gender !== 'male' && form.gender !== 'female') {
      setError(t('Vyber pohlavie.'))
      return
    }
    if (form.password !== form.confirmPassword) {
      setError(t('Heslá sa nezhodujú.'))
      return
    }

    setLoading(true)

    // Created on submit only, so prerendering never touches Supabase.
    const supabase = createClient()

    try {
      const displayName = form.name.trim()
      const email = form.email.trim()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          emailRedirectTo: emailRedirectUrl(window.location.origin),
          data: {
            display_name: displayName,
            full_name: displayName,
            country_code: registrationCountry,
            preferred_language: language,
            subdivision_code: subdivisionCode(registrationCountry, form.region),
            region: form.region,
            level: form.level,
            gender: form.gender,
            dominant_hand: form.dominantHand,
            home_venue_id: form.homeVenueId || null,
          },
        },
      })

      if (signUpError) {
        throw signUpError
      }

      // Supabase returns a user without identities when the e-mail is already registered
      // (it hides this to prevent e-mail enumeration and sends no new e-mail).
      if (data.user && !data.session && data.user.identities?.length === 0) {
        setError(t('Účet s týmto e-mailom už existuje. Prihlás sa, alebo si obnov heslo.'))
        return
      }

      // Require explicit OTP verification before the user can continue in the app.
      if (!data.session || !data.user?.email_confirmed_at) {
        if (data.session) await supabase.auth.signOut({ scope: 'local' })
        router.replace(`/auth/verify?email=${encodeURIComponent(email)}`)
        return
      }

      if (data.user && data.session) {
        await createPlayerProfile({
          full_name: data.user.user_metadata?.display_name?.trim() || displayName,
          country_code: registrationCountry,
          preferred_language: language,
          subdivision_code: subdivisionCode(registrationCountry, form.region),
          email: data.user.email?.trim() || email,
          phone: '',
          avatar_url: null,
          elo_rating: 1000,
          highest_elo: 1000,
          matches_played: 0,
          matches_won: 0,
          region: form.region,
          level: form.level,
          gender: form.gender,
          dominant_hand: form.dominantHand,
          home_venue_id: form.homeVenueId || null,
        })
      }

      // Confirmation is disabled in Supabase – the user is signed in immediately.
      router.push('/profile')
      router.refresh()
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Registráciu sa nepodarilo uskutočniť')
      console.error('Registrácia zlyhala:', message)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-app-ink px-4 sm:px-6 py-8 text-app-fg flex flex-col items-center justify-center">
      <div className="w-full max-w-sm md:max-w-md bg-app-auth p-6 sm:p-8 rounded-2xl border border-app-line/10 shadow-xl">
        <div className="flex justify-center mb-6">
          <RivaLogo />
        </div>
        <div className="mb-5 flex justify-center"><LeagueSelector languageOnly /></div>
        <h1 className="text-xl sm:text-2xl font-bold mb-6 text-center">{t('REGISTRÁCIA')}</h1>

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg mb-4 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm text-gray-400">
            {t('Krajina národnej ligy', 'National league country')}
            <select required value={registrationCountry} onChange={(event) => chooseCountry(event.target.value)} className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg">
              {SUPPORTED_COUNTRIES.map((item) => <option key={item.code} value={item.code}>{t(item.name)}</option>)}
            </select>
          </label>
          <div>
            <label className="text-sm text-gray-400">{t('Meno')}</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
              placeholder={t('Zadaj svoje meno')}
            />
          </div>

          <div>
            <label htmlFor="sign-up-gender" className="text-sm text-gray-400">{t('Pohlavie')}</label>
            <select id="sign-up-gender" name="gender" required value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value as Gender | '' })} className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400">
              <option value="" disabled>{t('Vyber pohlavie')}</option>
              <option value="male">{t('Muž')}</option>
              <option value="female">{t('Žena')}</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400">{t(registrationCountry === 'NL' ? 'Provincia' : 'Kraj')}</label>
            <select
              required
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
            >
              <option value="">{t(registrationCountry === 'NL' ? 'Vyber svoju provinciu' : 'Vyber svoj kraj')}</option>
              {regions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400">{t('Úroveň hráča')}</label>
            <select
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
            >
              <option value="">{t('Vyber úroveň')}</option>
              {['Začiatočník', 'Mierne pokročilý', 'Pokročilý', 'Expert'].map((level) => <option key={level} value={level}>{t(level)}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400">{t('Dominantná ruka')}</label>
            <select
              value={form.dominantHand}
              onChange={(e) => setForm({ ...form, dominantHand: e.target.value as DominantHand })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
            >
              <option value="right">{t('Pravák')}</option>
              <option value="left">{t('Ľavák')}</option>
              <option value="both">{t('Hráš oboma rukami')}</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400">{t('Domovská aréna')}</label>
            <select
              value={form.homeVenueId}
              onChange={(e) => setForm({ ...form, homeVenueId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
            >
              <option value="">{t('Vyber domovskú arénu')}</option>
              {arenas.map((arena) => <option key={arena.id} value={arena.id}>{arena.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-500">{t('Domovský klub sa automaticky upraví podľa najnavštevovanejšieho klubu.')}</p>
            {arenasError ? <p role="status" className="mt-1 text-xs text-app-amber-300">{t('Zoznam arén sa nepodarilo načítať.')}</p> : null}
          </div>

          <div>
            <label className="text-sm text-gray-400">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
              placeholder="vas@email.sk"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400">{t('Heslo')}</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400">{t('Potvrď heslo')}</label>
            <input
              type="password"
              required
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              className="mt-1 w-full rounded-lg border border-app-line/10 bg-app-ink px-4 py-2.5 text-app-fg focus:outline-none focus:border-green-400"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-[#b5ef33] hover:bg-[#a2db25] text-black font-semibold py-3 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {t(loading ? 'REGISTRUJEM...' : 'REGISTROVAŤ SA')}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-6">
          {t('Už máš účet?')}{' '}
          <Link href="/auth/login" className="text-app-lime hover:underline">
            {t('Prihlásiť sa')}
          </Link>
        </p>
      </div>
    </main>
  )
}
