export function AppBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="app-photo absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.24]"
        style={{ backgroundImage: "url('/images/padel-bg.jpg')" }}
      />
      <div className="profile-photo-shade absolute inset-0" />
    </div>
  )
}
