'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { createClient } from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/errors'
import { PlayerAvatar } from '@/components/player-avatar'

type Player = { id: string; name: string; avatarUrl: string | null }

export function QrPlayerSearch({ excludedIds, disabled, onSelect }: {
  excludedIds: string[]
  disabled: boolean
  onSelect: (player: { id: string; name: string }) => void
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Player[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [retry, setRetry] = useState(0)
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const search = query.trim()
  const visible = results.filter((player) => !excludedIds.includes(player.id))

  useEffect(() => {
    setResults([])
    setError('')
    setActive(-1)
    if (search.length < 2 || disabled) {
      setLoading(false)
      return
    }
    let current = true
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        // Escape LIKE wildcards; names/nicknames are stored in full_name.
        const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
        const { data, error: lookupError } = await createClient().from('proffiles')
          .select('id, full_name, avatar_url')
          .ilike('full_name', pattern)
          .order('full_name', { ascending: true })
          .limit(20)
          .abortSignal(controller.signal)
        if (lookupError) throw lookupError
        const players = (data ?? []).map((row): Player => {
          if (row.id == null || typeof row.full_name !== 'string' || !row.full_name.trim()) {
            throw new Error('Vyhľadávanie vrátilo neplatný profil hráča.')
          }
          return { id: String(row.id), name: row.full_name.trim(), avatarUrl: row.avatar_url ?? null }
        })
        if (current) setResults(players)
      } catch (lookupError) {
        if (!current) return
        console.error('Manuálne vyhľadávanie QR hráčov zlyhalo:', lookupError)
        setError(getErrorMessage(lookupError, 'Hráčov sa nepodarilo vyhľadať.'))
      } finally {
        if (current) setLoading(false)
      }
    }, 300)
    return () => {
      current = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [search, disabled, retry])

  useEffect(() => {
    if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listId])

  function choose(player: Player) {
    if (disabled || excludedIds.includes(player.id)) return
    onSelect(player)
    setQuery('')
    setResults([])
    setActive(-1)
    setOpen(false)
  }

  return <div ref={containerRef} className="mt-3 rounded-xl border border-white/15 bg-[#111827] p-4"
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
    <label htmlFor={`${listId}-input`} className="text-sm font-semibold">{t('Meno, priezvisko alebo prezývka', 'First name, surname or nickname')}</label>
    <div className="relative mt-2">
      <Search size={18} aria-hidden="true" className="absolute left-3 top-4 text-[#a8e63c]" />
      <input id={`${listId}-input`} autoFocus autoComplete="off" role="combobox" aria-autocomplete="list"
        aria-expanded={open && search.length >= 2} aria-controls={listId}
        aria-activedescendant={active >= 0 && visible[active] ? `${listId}-${active}` : undefined}
        aria-describedby={`${listId}-status`} value={query} disabled={disabled} maxLength={100}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); setActive(-1) }
          else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visible.length) {
            event.preventDefault()
            setOpen(true)
            setActive((index) => event.key === 'ArrowDown' ? (index + 1) % visible.length : index <= 0 ? visible.length - 1 : index - 1)
          } else if (event.key === 'Enter' && open && visible[active]) {
            event.preventDefault()
            choose(visible[active])
          }
        }}
        className="min-h-12 w-full rounded-xl border border-white/20 bg-[#1F2937] pl-10 pr-3 outline-none focus:border-[#a8e63c] disabled:opacity-50" />
    </div>
    <p id={`${listId}-status`} role="status" className="mt-2 text-xs text-white/60">
      {search.length < 2 ? t('Zadaj aspoň 2 znaky.', 'Enter at least 2 characters.')
        : loading ? t('Vyhľadávam hráčov…', 'Searching players…')
          : !error && visible.length === 0 ? t('Žiadny dostupný hráč sa nenašiel.', 'No available players found.') : ''}
    </p>
    {error ? <p role="alert" className="mt-2 text-sm text-red-200">{error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="underline">{t('Skúsiť znova', 'Retry')}</button></p> : null}
    {open && search.length >= 2 ? <ul id={listId} role="listbox" aria-label={t('Nájdení hráči', 'Matching players')} className="mt-2 max-h-64 overflow-y-auto">
      {!loading && !error && visible.map((player, index) => <li id={`${listId}-${index}`} key={player.id} role="option"
        aria-selected={index === active} aria-disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(player)}
        className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 hover:bg-[#a8e63c]/10 ${index === active ? 'bg-[#a8e63c]/10 text-[#a8e63c]' : ''}`}>
        <PlayerAvatar name={player.name} src={player.avatarUrl} className="size-10 text-sm" />
        <span className="font-semibold">{player.name}</span>
      </li>)}
    </ul> : null}
  </div>
}
