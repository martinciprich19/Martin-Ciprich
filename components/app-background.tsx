export function AppBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 h-[100svh] -z-10">
      <div
        className="absolute inset-0 bg-contain bg-center bg-no-repeat opacity-[0.24]"
        style={{ backgroundImage: "url('/images/padel-bg.jpg')" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b0f17]/20 via-[#0b0f17]/40 to-[#0b0f17]/70" />
    </div>
  )
}
