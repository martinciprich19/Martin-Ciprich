type SplLogoProps = {
  size?: 'sm' | 'md' | 'lg' | 'header'
  className?: string
}

const sizes = {
  sm: 'size-9',
  md: 'size-16',
  lg: 'size-20',
  header: 'size-11 sm:size-16',
}

export function SplLogo({ size = 'md', className }: SplLogoProps) {
  return (
    <span
      className={[
        'relative block shrink-0 overflow-hidden',
        size === 'sm' ? 'rounded-lg ring-1' : 'rounded-2xl',
        ' bg-[#0d1a33] ring-2 ring-[#ccff00]/70 shadow-[0_0_24px_rgba(204,255,0,0.28)] transition duration-300 hover:ring-[#ccff00] hover:shadow-[0_0_32px_rgba(204,255,0,0.45)]',
        sizes[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <img
        src="/images/spl-logo.jpg"
        alt="SPL — Slovak Padel League"
        decoding="async"
        className="size-full scale-[1.18] object-cover object-center brightness-110 contrast-110"
      />
    </span>
  )
}
