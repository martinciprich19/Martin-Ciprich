export function StartupSplash() {
  return (
    <div className="startup-splash" aria-hidden="true">
      <div className="startup-splash-mark">
        <div className="startup-splash-aura" />
        <img
          src="/images/riva-padel-play-together-compact-logo.png?v=3"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="startup-splash-logo"
        />
        <svg className="startup-splash-outline" viewBox="0 0 108 108">
          <rect x="5" y="5" width="98" height="98" rx="22" pathLength="100" />
        </svg>
      </div>
    </div>
  )
}
