'use client'

import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { RivaLogo } from '@/components/riva-logo'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetchArenas } from '@/lib/arenas'
import { createPlayerProfile, type DominantHand, type Gender } from '@/lib/profiles'
import { getErrorMessage } from '@/lib/errors'
import { emailRedirectUrl } from '@/lib/auth-redirect'

export default function SignUpPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', region: '', level: '', gender: '' as Gender | '', dominantHand: 'right' as DominantHand, homeVenueId: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { data: arenas = [], error: arenasError } = useSWR('arenas', fetchArenas)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')

    if (form.gender !== 'male' && form.gender !== 'female') {
      setError('Vyber pohlavie.')
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('Heslá sa nezhodujú.')
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
        setError('Účet s týmto e-mailom už existuje. Prihlás sa, alebo si obnov heslo.')
        return
      }

      // E-mail confirmation is required: no session until the user clicks the link in the e-mail.
      if (!data.session || !data.user?.email_confirmed_at) {
        if (data.session) await supabase.auth.signOut({ scope: 'local' })
        router.replace(`/auth/sign-up-success?email=${encodeURIComponent(email)}`)
        return
      }

      if (data.user && data.session) {
        await createPlayerProfile({
          full_name: data.user.user_metadata?.display_name?.trim() || displayName,
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
    <main className="min-h-screen bg-[#061016] px-4 sm:px-6 py-8 text-white flex flex-col items-center justify-center">
      <div className="w-full max-w-sm md:max-w-md bg-[#0b1922] p-6 sm:p-8 rounded-2xl border border-white/10 shadow-xl">
        <div className="flex justify-center mb-6">
          <RivaLogo />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold mb-6 text-center">REGISTRÁCIA</h1>

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded-lg mb-4 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm text-gray-400">Meno</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400"
              placeholder="Zadaj svoje meno"
            />
          </div>

          <div>
            <label htmlFor="sign-up-gender" className="text-sm text-gray-400">Pohlavie</label>
            <select id="sign-up-gender" name="gender" required value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value as Gender | '' })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400">
              <option value="" disabled>Vyber pohlavie</option>
              <option value="male">Muž</option>
              <option value="female">Žena</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400">Kraj</label>
            <select
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400"
            >
              <option value="">Vyber svoj kraj</option>
              <option value="Bratislavský">Bratislavský kraj</option>
              <option value="Trnavský">Trnavský kraj</option>
              <option value="Trenčiansky">Trenčiansky kraj</option>
              <option value="Nitriansky">Nitriansky kraj</option>
              <option value="Žilinský">Žilinský kraj</option>
              <option value="Banskobystrický">Banskobystrický kraj</option>
              <option value="Prešovský">Prešovský kraj</option>
              <option value="Košický">Košický kraj</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400">Úroveň hráča</label>
            <select
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400"
            >
              <option value="">Vyber úroveň</option>
              <option value="Začiatočník">Začiatočník</option>
              <option value="Mierne pokročilý">Mierne pokročilý</option>
              <option value="Pokročilý">Pokročilý</option>
              <option value="Expert">Expert</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400">Dominantná ruka</label>
            <select
              value={form.dominantHand}
              onChange={(e) => setForm({ ...form, dominantHand: e.target.value as DominantHand })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400"
            >
              <option value="right">Pravák</option>
              <option value="left">Ľavák</option>
              <option value="both">Hráš oboma rukami</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-gray-400">Domovská aréna</label>
            <select
              value={form.homeVenueId}
              onChange={(e) => setForm({ ...form, homeVenueId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400"
            >
              <option value="">Vyber domovskú arénu</option>
              {arenas.map((arena) => <option key={arena.id} value={arena.id}>{arena.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-500">Domovský klub sa automaticky upraví podľa najnavštevovanejšieho klubu.</p>
            {arenasError ? <p role="status" className="mt-1 text-xs text-amber-300">Zoznam arén sa nepodarilo načítať.</p> : null}
          </div>

          <div>
            <label className="text-sm text-gray-400">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400"
              placeholder="vas@email.sk"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400">Heslo</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400">Potvrď heslo</label>
            <input
              type="password"
              required
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#061016] px-4 py-2.5 text-white focus:outline-none focus:border-green-400"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-[#b5ef33] hover:bg-[#a2db25] text-black font-semibold py-3 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? 'REGISTRUJEM...' : 'REGISTROVAŤ SA'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-6">
          Už máš účet?{' '}
          <Link href="/auth/login" className="text-[#b5ef33] hover:underline">
            Prihlásiť sa
          </Link>
        </p>
      </div>
    </main>
  )
}
