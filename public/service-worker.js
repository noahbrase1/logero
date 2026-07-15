// Bump this on any change to the caching strategy below so old caches from
// a prior version get cleaned up on activate.
const CACHE_VERSION = 'v1'
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

  // Everything else same-origin (the hashed JS/CSS/image bundle Vite
  // builds): cache-first, since a given hashed filename's contents never
  // change — this is what makes repeat visits load instantly.
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
})
