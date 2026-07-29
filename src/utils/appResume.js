// Fires `callback` when the app returns to the foreground after being
// backgrounded — the moment on a phone when a previously-suspended tab's
// timers/sockets resume, which is when a stuck loading state or a silently
// dropped Supabase realtime connection needs to be proactively recovered
// rather than left to hang until the user force-closes and reopens the app.
//
// `visibilitychange` is the primary, universally-supported signal for this
// (tab switching, phone app-switching/locking, OS sleep/wake). `pageshow`'s
// `event.persisted` additionally covers a bfcache restore (notably iOS
// Safari, which can restore a backgrounded PWA from the back-forward cache
// rather than re-running this module's top-level code at all) — without it,
// a bfcache-restored page would never re-fire any of this recovery logic.
// Both listeners are debounced together so a resume that fires both in
// close succession only triggers one recovery pass, not two.
export function onAppResume(callback) {
  let lastFired = 0

  function fire() {
    const now = Date.now()
    if (now - lastFired < 1000) return
    lastFired = now
    callback()
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') fire()
  }

  function handlePageShow(event) {
    if (event.persisted) fire()
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('pageshow', handlePageShow)

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('pageshow', handlePageShow)
  }
}
