export function StartupSplash() {
  return (
    <div className="startup-splash" aria-hidden="true">
      <div className="startup-splash-aura" />
      <img
        src="/images/riva-padel-play-together-compact-logo.png?v=2"
        alt=""
        fetchPriority="high"
        decoding="async"
        className="startup-splash-logo"
      />
    </div>
  )
}
