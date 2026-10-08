type RivaLogoProps = {
  size?: 'sm' | 'md' | 'lg' | 'header'
  className?: string
}

const sizes = {
  sm: 'size-9',
  md: 'size-16',
  lg: 'size-20',
  header: 'size-11 sm:size-16',
}

export function RivaLogo({ size = 'md', className }: RivaLogoProps) {
  return (
    <span
      className={[
        'relative block shrink-0 overflow-hidden rounded-[24%] border border-[#a8e63c]/70 bg-[#061016] shadow-[0_0_16px_rgba(168,230,60,0.3)] motion-safe:transition-shadow hover:shadow-[0_0_24px_rgba(168,230,60,0.45)]',
        sizes[size],
        className,
      ].filter(Boolean).join(' ')}
    >
      <img
        src="/images/riva-padel-play-together-logo.png"
        alt="RIVA Padel"
        decoding="async"
        className="block size-full rounded-[inherit] object-contain"
      />
    </span>
  )
}
