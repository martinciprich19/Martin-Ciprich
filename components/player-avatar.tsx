import type { Gender } from '@/lib/profiles'
import { playerAccentColor } from '@/lib/player-accent'

export function PlayerAvatar({ name, src, gender, className = 'size-9 text-xs' }: {
  name: string
  src?: string | null
  gender?: Gender | null
  className?: string
}) {
  const accent = playerAccentColor(gender)
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black text-[#10150d] ring-2 ring-[var(--player-accent)] ${className}`}
      style={{ backgroundColor: accent, '--player-accent': accent } as React.CSSProperties}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : name.slice(0, 1).toUpperCase() || '?'}
    </span>
  )
}
