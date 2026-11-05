'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'

type Player = { id: number; full_name: string; elo_rating: number; career_elo: number }
type Adjustment = { id: string; player_id: number; created_at: string; actor_id: string; reason: string; before_season: number; after_season: number; before_career: number; after_career: number; season_start: string }
const failureMessage = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Požiadavka zlyhala.'

export function SuperAdminElo() {
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState<Player[]>([])
  const [player, setPlayer] = useState<Player | null>(null)
  const [scope, setScope] = useState('season')
  const [season, setSeason] = useState('')
  const [career, setCareer] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [notice, setNotice] = useState('')
  const [offset, setOffset] = useState(0)
  const lock = useRef(false)
  const request = useRef<{ key: string; id: string } | null>(null)
  const { data: history, error, mutate } = useSWR(['elo-history', player?.id ?? null, offset], async (): Promise<Adjustment[]> => {
    let query = createClient().from('elo_adjustments').select('id,player_id,created_at,actor_id,reason,before_season,after_season,before_career,after_career,season_start')
    if (player) query = query.eq('player_id', player.id)
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49)
    if (error) { console.error('ELO history failed:', error); throw new Error('Históriu ELO sa nepodarilo načítať. Over migráciu 089.') }
    return data ?? []
  }, { refreshInterval: 30000 })
  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setErrorText(''); setNotice('')
    try {
      const { data, error } = await createClient().rpc('super_admin_search_elo_players', { p_query: query.trim() })
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Neplatná odpoveď vyhľadávania.')
      setPlayers(data); setPlayer(null); setOffset(0)
      if (!data.length) setNotice('Nenašiel sa žiadny hráč.')
    } catch (failure) { console.error('ELO player search failed:', failure); setErrorText(failureMessage(failure)) }
    finally { lock.current = false; setBusy(false) }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!player || lock.current) return
    lock.current = true; setBusy(true); setErrorText(''); setNotice('')
    try {
      const integer = (value: string) => {
        if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < -2147483648 || Number(value) > 2147483647) throw new Error('ELO musí byť celé číslo v rozsahu databázového integer.')
        return Number(value)
      }
      const args = { p_player_id: player.id, p_expected_season: player.elo_rating, p_expected_career: player.career_elo,
        p_target_season: scope === 'career' ? null : integer(season), p_target_career: scope === 'season' ? null : integer(career), p_reason: reason.trim() }
      if (!window.confirm(`Uložiť opravu ELO hráča ${player.full_name} (ID ${player.id})? Dôvod: ${reason.trim()}`)) return
      const key = JSON.stringify(args)
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
      const { error } = await createClient().rpc('super_admin_adjust_elo', { ...args, p_id: request.current.id })
      if (error) throw error
      request.current = null; setPlayer(null); setPlayers([]); setReason(''); setOffset(0)
      setNotice('Oprava ELO bola uložená aj do histórie. Pre ďalšiu úpravu znovu načítaj hráča.'); await mutate()
    } catch (failure) { console.error('ELO correction failed:', failure); setErrorText(failureMessage(failure)) }
    finally { lock.current = false; setBusy(false) }
  }
  const input = 'mt-1 block w-full rounded-lg border border-app-line/15 bg-app-ink p-3'
  return <section className="mt-7 space-y-4 rounded-2xl border border-app-line/10 bg-app-panel p-5">
    <h2 className="text-xl font-black">Manuálne opravy ELO</h2>
    <p className="text-sm text-app-fg/60">Oprava sa uloží ako rozdiel v aktuálnom čase a zapojí do prepočtu zápasov. Sezónny rozdiel platí len v aktuálnej polročnej sezóne; kariérny zostáva. Budúce zápasy vychádzajú aj z opravy. Spätné zmeny výsledkov môžu prepočítať ELO, ale nezmažú záznam opravy. Počty výhier a zápasov sa manuálnou opravou nemenia.</p>
    <form onSubmit={search} className="flex flex-wrap items-end gap-3"><label className="flex-1 text-sm">Meno alebo presné ID hráča<input maxLength={100} required value={query} disabled={busy} onChange={e => setQuery(e.target.value)} className={input} /></label><button disabled={busy} className="rounded border border-app-line/20 px-4 py-3">Vyhľadať / obnoviť hráča</button></form>
    {error || errorText ? <p role="alert" className="text-red-300">{errorText || error.message}</p> : null}
    {notice ? <p role="status" className="text-emerald-300">{notice}</p> : null}
    <ul className="space-y-2">{players.map(row => <li key={row.id}><button disabled={busy} onClick={() => { setPlayer(row); setSeason(String(row.elo_rating)); setCareer(String(row.career_elo)); setReason(''); setOffset(0) }} className="w-full rounded border border-app-line/15 p-3 text-left">{row.full_name} · ID {row.id} · sezónne {row.elo_rating} · kariérne {row.career_elo}</button></li>)}</ul>
    {player ? <form onSubmit={save} className="space-y-3 rounded border border-app-line/15 p-4">
      <h3 className="font-bold">{player.full_name} · ID {player.id}</h3>
      <p className="text-sm">Načítané ELO: sezónne {player.elo_rating}, kariérne {player.career_elo}. Pri súbežnej zmene sa uloženie odmietne.</p>
      <label className="block text-sm">Čo opraviť<select value={scope} disabled={busy} onChange={e => setScope(e.target.value)} className={input}><option value="season">Sezónne ELO</option><option value="career">Kariérne ELO</option><option value="both">Obe ELO</option></select></label>
      {scope !== 'career' ? <label className="block text-sm">Nové sezónne ELO<input required type="number" step="1" value={season} disabled={busy} onChange={e => setSeason(e.target.value)} className={input} /></label> : null}
      {scope !== 'season' ? <label className="block text-sm">Nové kariérne ELO<input required type="number" step="1" value={career} disabled={busy} onChange={e => setCareer(e.target.value)} className={input} /></label> : null}
      <label className="block text-sm">Dôvod opravy<textarea required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} className={input} /></label>
      <button disabled={busy} className="rounded-lg bg-app-league px-4 py-3 font-bold text-app-ink disabled:opacity-40">Potvrdiť opravu ELO</button>
    </form> : null}
    <div className="flex flex-wrap gap-3"><h3 className="font-bold">História opráv {player ? `hráča ID ${player.id}` : 'všetkých hráčov'}</h3><button onClick={() => { setPlayer(null); setOffset(0) }} className="text-sm text-app-league">Všetci hráči</button><button onClick={() => void mutate()} className="text-sm text-app-league">Obnoviť históriu</button></div>
    {!error && history ? <><ul className="divide-y divide-app-line/10">{history.map(row => <li key={row.id} className="space-y-1 py-3 text-sm">
      <p className="font-bold">Hráč ID {row.player_id} · sezónne {row.before_season} → {row.after_season} · kariérne {row.before_career} → {row.after_career}</p><p>{row.reason}</p><p className="break-all text-xs text-app-fg/50">{new Date(row.created_at).toLocaleString('sk-SK')} · sezóna {row.season_start} · správca {row.actor_id} · ID {row.id}</p>
    </li>)}</ul>{history.length === 0 ? <p>Žiadne opravy na tejto strane.</p> : null}<div className="flex gap-3"><button disabled={offset === 0} onClick={() => setOffset(offset - 50)} className="rounded border border-app-line/20 px-3 py-2 disabled:opacity-40">Predchádzajúce</button><button disabled={history.length < 50} onClick={() => setOffset(offset + 50)} className="rounded border border-app-line/20 px-3 py-2 disabled:opacity-40">Ďalšie</button></div></> : null}
  </section>
}
