'use client'

import { ChevronRight } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'

export function MatchDetailButton({ matchId, onOpen }: { matchId: string; onOpen: (matchId: string) => void }) {
  const { t } = useLanguage()
  return <button type="button" aria-haspopup="dialog" onClick={(event) => {
    event.stopPropagation()
    onOpen(matchId)
  }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#ccff00]/25 bg-[#ccff00]/10 px-3 py-2 text-left text-xs font-bold text-[#ccff00] transition-colors hover:bg-[#ccff00]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ccff00]">
    {t('Zobraziť detail zápasu', 'View match details')}<ChevronRight size={14} className="shrink-0" aria-hidden="true" />
  </button>
}
