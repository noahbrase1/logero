// Bump this on any change to the caching strategy below so old caches from
// a prior version get cleaned up on activate.
const CACHE_VERSION = 'v2'
const CACHE_NAME = `logero-${CACHE_VERSION}`
const OFFLINE_URL = '/offline.html'

const PRECACHE_URLS = [OFFLINE_URL, '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Never intercept cross-origin requests (Supabase API/auth/realtime) —
  // this app has no offline data story, only an offline app-shell fallback.
  if (url.origin !== self.location.origin) return

  // Page navigations: always prefer a fresh network response so the app
  // shell doesn't go stale, but fall back to a cached copy (or the offline
  // page as a last resort) when there's no connection.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)))
    )
    return
  }

  // Vite's build output (/assets/*.js, /assets/*.css, etc.): cache-first,
  // since these filenames are content-hashed — a given filename's contents
  // truly never change, which is what makes repeat visits load instantly.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
            }
            return response
          })
          .catch(() => cached)
      })
    )
    return
  }

  // Everything else same-origin (favicon/logo/manifest/icons in public/):
  // these keep a stable filename even when their contents change, so
  // cache-first would keep serving a stale copy forever after a rebrand —
  // network-first instead, falling back to cache only when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request))
  )
})

// --- Push notifications ---
// The payload is set by the send-push-notification Edge Function as JSON:
// { title, body, url }. `url` is where notificationclick below should send
// the user — e.g. /messages/<conversation-id> for a new message.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Logero', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Logero'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// Focuses an already-open tab on the target page if one exists, navigates an
// already-open tab there if not, or opens a new one as a last resort —
// rather than always opening a fresh tab regardless of what's already open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (new URL(client.url).pathname === targetUrl && 'focus' in client) {
          return client.focus()
        }
      }
      for (const client of clientsList) {
        if ('focus' in client) {
          client.focus()
          return 'navigate' in client ? client.navigate(targetUrl) : undefined
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    })
  )
})
