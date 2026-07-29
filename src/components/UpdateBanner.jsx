import { useEffect, useState } from 'react'

// Owns the service worker registration itself (moved here from main.jsx)
// so the update-detection logic below has direct access to the
// registration it's watching, rather than main.jsx registering it blind
// and this component trying to re-discover it separately.
//
// The service worker already calls self.skipWaiting()/clients.claim() (see
// public/service-worker.js), so a new version takes over an already-open
// tab immediately rather than waiting for every tab to close — but that
// means the *page* can end up controlled by a newer service worker than
// the JS bundle it already loaded into memory, silently. Rather than leave
// that mismatch to cause confusing stale-code bugs, this surfaces a
// lightweight "refresh to update" prompt the moment that happens.
export default function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if (!(import.meta.env.PROD && 'serviceWorker' in navigator)) return

    // Captured before registration even starts: if this page was already
    // being controlled by a service worker when it loaded, then a later
    // `controllerchange` means a *new* version just took over — a genuine
    // update worth prompting about. If there was no controller yet (a
    // brand-new install), clients.claim() taking control for the first
    // time also fires `controllerchange`, but that's not an update, so it's
    // deliberately not surfaced.
    const hadController = Boolean(navigator.serviceWorker.controller)

    function handleControllerChange() {
      if (hadController) setUpdateAvailable(true)
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

    let registration
    function handleLoad() {
      navigator.serviceWorker
        .register('/service-worker.js')
        .then((reg) => {
          registration = reg
        })
        .catch((err) => console.error('SW registration failed', err))
    }
    // React's effects run after mount, which can land after the browser's
    // own `load` event already fired (unlike the old plain top-level script
    // in main.jsx, which ran early enough that `load` was still pending) —
    // registering only ever attaches a listener for an event that already
    // happened would silently never register the service worker at all.
    if (document.readyState === 'complete') {
      handleLoad()
    } else {
      window.addEventListener('load', handleLoad)
    }

    // Browsers only check for a new service worker script on navigation by
    // default — for an app that can stay open/backgrounded for a long time
    // without a fresh navigation, that means an update could go undetected
    // for a while. Re-check explicitly whenever the app comes back to the
    // foreground (see src/utils/appResume.js) rather than relying on that.
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') registration?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
      window.removeEventListener('load', handleLoad)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  if (!updateAvailable) return null

  return (
    <div className="update-banner" role="status">
      <span>A new version is available.</span>
      <button type="button" onClick={() => window.location.reload()}>
        Refresh
      </button>
    </div>
  )
}
