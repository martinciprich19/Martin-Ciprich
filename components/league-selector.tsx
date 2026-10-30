'use client'

import { useLeague } from '@/components/league-provider'
import { useLanguage } from '@/components/language-provider'
import { isCountryCode, SUPPORTED_COUNTRIES } from '@/lib/countries'

export function LeagueSelector({ languageOnly = false }: { languageOnly?: boolean }) {
  const { country, setCountry } = useLeague()
  const { language, setLanguage, t } = useLanguage()
  const fieldClass = 'min-h-10 max-w-full rounded-lg border border-app-line/15 bg-app-panel px-2 py-2 text-xs text-app-fg'
  return (
    <div className="flex flex-wrap gap-2">
      {!languageOnly ? <label className="min-w-0">
        <span className="sr-only">{t('Národná liga', 'National league')}</span>
        <select aria-label={t('Národná liga', 'National league')} value={country} onChange={(event) => { if (isCountryCode(event.target.value)) setCountry(event.target.value) }} className={fieldClass}>
          {SUPPORTED_COUNTRIES.map((item) => <option key={item.code} value={item.code}>{t(item.name, item.code === 'SK' ? 'Slovakia' : 'Netherlands')}</option>)}
        </select>
      </label> : null}
      <div className="flex items-center gap-1" role="group" aria-label={t('Jazyk', 'Language')}>
        {([
          { code: 'sk', label: 'Slovenčina', flag: 'sk' },
          { code: 'nl', label: 'Nederlands', flag: 'nl' },
          { code: 'en', label: 'English', flag: 'gb' },
        ] as const).map(({ code, label, flag }) => (
          <button key={code} type="button" onClick={() => setLanguage(code)} aria-label={label} title={label} aria-pressed={language === code} className={`flex h-11 w-11 items-center justify-center rounded-lg border p-2 transition-colors ${language === code ? 'border-[#ccff00] bg-[#ccff00]/15 ring-2 ring-[#ccff00]/30' : 'border-app-line/15 bg-app-panel opacity-60 hover:opacity-100'}`}>
            <img src={`/images/flags/${flag}.svg`} alt="" className="h-5 w-7 rounded-sm object-cover" />
          </button>
        ))}
      </div>
    </div>
  )
}
