import { supabase } from './supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// PushManager.subscribe() needs the VAPID key as a Uint8Array, not the
// base64url string it's distributed as.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// The toggle's displayed state: true only when this specific browser both
// has notification permission and an active push subscription. Deliberately
// not a DB read — a user can be opted in on multiple devices, and each
// device's toggle should reflect its own subscription, not a shared
// account-wide flag.
export async function getCurrentSubscription() {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

// Requesting permission must happen from a direct user action (the toggle's
// onChange handler) — calling this on page load would be silently ignored
// by the browser at best, or burn the one permission prompt a site gets at
// worst.
export async function enablePushNotifications(userId) {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser.')
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('Push notifications are not configured for this app yet.')
  }

  const permission = await Notification.requestPermission()
  if (permission === 'denied') {
    throw new Error(
      "Notifications are blocked for this site. To turn them on, allow notifications for this site in your browser or phone's settings, then try again."
    )
  }
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: userId, endpoint: subscription.endpoint, subscription: subscription.toJSON() },
      { onConflict: 'user_id,endpoint' }
    )
  if (error) throw error

  return subscription
}

// Unsubscribes this browser specifically and removes only its own row —
// another device the user opted in from stays subscribed.
export async function disablePushNotifications(userId) {
  if (!isPushSupported()) return

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()

  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint)
  if (error) throw error
}
