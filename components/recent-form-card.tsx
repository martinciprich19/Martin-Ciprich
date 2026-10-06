'use client'

import { FORM_LENGTH, type FormResult } from '@/lib/recent-form'
import type { ProfileMatch } from '@/lib/profile-matches'

const RESULT_STYLES: Record<FormResult, { letter: string; label: string; className: string }> = {
  W: { letter: 'V', label: 'Výhra', className: 'bg-[#35d6a2] text-[#10150d]' },
  L: { letter: 'P', label: 'Prehra', className: 'bg-red-500 text-white' },
}

export function RecentFormCard({ matches, isLoading, error }: { matches: ProfileMatch[]; isLoading: boolean; error: unknown }) {
  const form: FormResult[] = matches.slice(0, FORM_LENGTH).reverse().map((match) => match.result === 'win' ? 'W' : 'L')

  return (
    <article className="rounded-2xl border border-white/[0.08] bg-[#111722] p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Aktuálna séria</p>
      <ol className="mt-4 flex items-center gap-1.5" aria-label={`Forma v posledných ${FORM_LENGTH} odohratých zápasoch, od najstaršieho po najnovší`}>
        {form.map((result, index) => {
          const style = RESULT_STYLES[result]
          return (
            <li
              key={`${result}-${index}`}
              title={style.label}
              className={[
                'flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-black',
                style.className,
                isLoading ? 'animate-pulse' : '',
              ].join(' ')}
            >
              {style.letter}
              <span className="sr-only">{style.label}</span>
            </li>
          )
        })}
      </ol>
    </article>
  )
}
