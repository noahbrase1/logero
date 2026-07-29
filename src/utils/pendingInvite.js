// Persists the invite code from a /join?invite=CODE visit across a full PWA
// install. An installed app's start_url is always "/" (see
// public/manifest.json) — a user who visits /join, installs to their home
// screen, and only opens the app later (or fully closes it first) would
// otherwise lose the code the moment the ?invite= query string falls away.
// Stashing it here lets App.jsx's logged-out entry point recover it and
// route straight to signup with the right team applied instead.

const STORAGE_KEY = 'pending_invite_code'
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days — a stale, long-forgotten
// code shouldn't linger indefinitely or incorrectly apply to a much later,
// unrelated signup on the same device.

export function savePendingInvite(code) {
  if (!code) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, savedAt: Date.now() }))
  } catch {
    // Storage unavailable (private browsing, quota) — the code just won't
    // survive an install; not worth surfacing as an error on the join page.
  }
}

// Returns the still-valid pending code, or null if there isn't one / it's
// expired / the stored value is corrupted — clearing it in the latter two
// cases so a bad entry doesn't keep getting re-read on every check.
export function getPendingInvite() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const { code, savedAt } = JSON.parse(raw)
    if (!code || !savedAt || Date.now() - savedAt > EXPIRY_MS) {
      clearPendingInvite()
      return null
    }
    return code
  } catch {
    clearPendingInvite()
    return null
  }
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}
