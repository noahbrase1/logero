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

// This specific browser's own subscription, if any. Deliberately not a DB
// read — a user can be opted in on multiple devices, and each device's
// toggles should reflect its own subscription, not a shared account-wide
// flag.
export async function getCurrentSubscription() {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

// The two notification types' on/off state for this browser — both false
// (not just "unset") when this browser was never subscribed at all, which
// is what lets AccountSettingsPage show two unchecked toggles instead of
// erroring on a first visit.
export async function getNotificationPreferences(userId) {
  const subscription = await getCurrentSubscription()
  if (!subscription) return { notifyMessages: false, notifyCalendar: false }

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('notify_messages, notify_calendar')
    .eq('user_id', userId)
    .eq('endpoint', subscription.endpoint)
    .maybeSingle()
  if (error) throw error

  // A subscription can exist with no matching row yet only in a narrow
  // in-between window (never in steady state) — default to the same
  // "messages on, calendar off" shape a fresh subscribe() below creates.
  return {
    notifyMessages: data?.notify_messages ?? true,
    notifyCalendar: data?.notify_calendar ?? false,
  }
}

// Requesting permission must happen from a direct user action (a toggle's
// onChange handler) — calling this on page load would be silently ignored
// by the browser at best, or burn the one permission prompt a site gets at
// worst. Shared by both notification types below: whichever one is turned
// on first, if this browser has no subscription yet, needs one created.
async function ensureSubscribed() {
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
  return subscription
}

// Unsubscribes this browser specifically and removes only its own row —
// another device the user opted in from stays subscribed. Turns both
// notification types off at once, since there's no longer a subscription
// for either to attach to.
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

// Turns one notification type ('messages' | 'calendar') on or off for this
// browser, independently of the other. Turning one on subscribes the
// browser first if it isn't already (prompting for permission); turning one
// off just flips that column to false — unless the *other* type is already
// off too, in which case there's nothing left this subscription would ever
// be used for, so it's torn down the same way disablePushNotifications()
// does, rather than leaving a row that can never be sent to.
export async function setNotificationPreference(userId, type, enabled) {
  const column = type === 'messages' ? 'notify_messages' : 'notify_calendar'
  const otherColumn = type === 'messages' ? 'notify_calendar' : 'notify_messages'

  if (enabled) {
    const subscription = await ensureSubscribed()
    const { data: existing, error: fetchError } = await supabase
      .from('push_subscriptions')
      .select(otherColumn)
      .eq('user_id', userId)
      .eq('endpoint', subscription.endpoint)
      .maybeSingle()
    if (fetchError) throw fetchError

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        subscription: subscription.toJSON(),
        [column]: true,
        [otherColumn]: existing?.[otherColumn] ?? false,
      },
      { onConflict: 'user_id,endpoint' }
    )
    if (error) throw error
    return
  }

  const subscription = await getCurrentSubscription()
  if (!subscription) return // nothing to turn off

  const { data: existing, error: fetchError } = await supabase
    .from('push_subscriptions')
    .select(otherColumn)
    .eq('user_id', userId)
    .eq('endpoint', subscription.endpoint)
    .maybeSingle()
  if (fetchError) throw fetchError

  if (!existing?.[otherColumn]) {
    await disablePushNotifications(userId)
    return
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .update({ [column]: false })
    .eq('user_id', userId)
    .eq('endpoint', subscription.endpoint)
  if (error) throw error
}
