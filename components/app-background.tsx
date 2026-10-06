export function AppBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.24] blur-[2px]"
        style={{ backgroundImage: "url('/images/padel-bg.jpg')" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0b0f17]/20 via-[#0b0f17]/40 to-[#0b0f17]/70" />
    </div>
  )
}
