import { useEffect, useState } from 'react'

// iPadOS 13+ reports itself as "Macintosh" in the user agent (masquerading
// as desktop Safari) but is still touch-only — maxTouchPoints > 1 is what
// actually distinguishes a real Mac from an iPad here.
function detectPlatform() {
  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)
  const isStandalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true
  return { isIOS, isAndroid, isStandalone }
}

// Platform-aware install UI: a real one-tap install button wherever the
// browser supports it (Android Chrome, desktop Chrome/Edge — anywhere
// `beforeinstallprompt` fires), step-by-step manual instructions for iOS
// Safari (which has no install API at all), and a generic fallback for
// anything else. Shared by JoinPage (the invite + install combined flow)
// and the standalone InstallPage.
export default function InstallInstructions() {
  const [platform] = useState(detectPlatform)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      // Stops the browser's own default mini-infobar so this page's own
      // button is the one control offering install, rather than two.
      event.preventDefault()
      setDeferredPrompt(event)
    }
    function handleAppInstalled() {
      setDeferredPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function handleInstallClick() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    // A used prompt event can't be reused for a second install attempt —
    // the browser won't fire another beforeinstallprompt until next visit.
    setDeferredPrompt(null)
  }

  if (platform.isStandalone || installed) {
    return <p className="form-info">You're already using the installed app on this device.</p>
  }

  if (deferredPrompt) {
    return (
      <button type="button" onClick={handleInstallClick}>
        Install app
      </button>
    )
  }

  if (platform.isIOS) {
    return (
      <ol className="install-steps">
        <li>
          Tap the Share icon <span aria-hidden="true">⬆️</span> in Safari's toolbar.
        </li>
        <li>Scroll down and tap "Add to Home Screen".</li>
        <li>Tap "Add" in the top corner.</li>
      </ol>
    )
  }

  if (platform.isAndroid) {
    return (
      <ol className="install-steps">
        <li>Tap the menu (⋮) in Chrome's toolbar.</li>
        <li>Tap "Add to Home screen" or "Install app".</li>
      </ol>
    )
  }

  return (
    <p className="page-subtitle">
      Open this link on your phone to install, or look for an install icon in your desktop browser's address bar.
    </p>
  )
}
