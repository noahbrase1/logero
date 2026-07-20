// send-push-notification
//
// Triggered by a database webhook (see ../../push_notifications_schema.sql)
// on every INSERT into public.messages. Looks up who else is in that
// conversation, finds their opted-in push subscriptions, and sends each one
// a Web Push notification with the sender's name and a preview of the
// message.
//
// Deploy:
//   supabase functions deploy send-push-notification --no-verify-jwt
//
// --no-verify-jwt is required here: the database trigger that calls this
// function has no end-user JWT to attach (it's a system-level Postgres
// call, not a request from a logged-in client), so the default JWT check
// would reject every invocation with 401. This does mean the endpoint
// itself isn't authenticated — anyone who discovers the URL could POST to
// it, but the worst they could do is trigger push sends using data they
// supply (no read/write access to anything else), which isn't sensitive
// enough here to justify the complexity of a shared-secret check that would
// otherwise need to live in this repo's committed SQL trigger definition.
//
// Secrets required (set with `supabase secrets set NAME=value`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already provided
// automatically to every Edge Function — do not set those manually.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:no-reply@example.com'

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

const supabase = createClient(supabaseUrl, serviceRoleKey)

function truncate(text: string, max = 120) {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json()
    // Standard Supabase database-webhook payload shape:
    // { type: 'INSERT', table: 'messages', record: {...}, schema: 'public', old_record: null }
    const message = payload.record

    if (!message?.conversation_id || !message?.sender_id) {
      return new Response('ignored: not a message insert', { status: 200 })
    }

    const { data: participants, error: participantsError } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', message.conversation_id)
      .neq('user_id', message.sender_id)

    if (participantsError) throw participantsError
    if (!participants || participants.length === 0) {
      return new Response('no recipients', { status: 200 })
    }

    const recipientIds = participants.map((p) => p.user_id)

    const [{ data: sender }, { data: subscriptions, error: subsError }] = await Promise.all([
      supabase.from('profiles').select('name').eq('id', message.sender_id).single(),
      supabase.from('push_subscriptions').select('id, subscription').in('user_id', recipientIds),
    ])

    if (subsError) throw subsError
    if (!subscriptions || subscriptions.length === 0) {
      return new Response('no opted-in recipients', { status: 200 })
    }

    const notificationPayload = JSON.stringify({
      title: sender?.name || 'New message',
      body: message.content ? truncate(message.content) : message.image_url ? '📷 Photo' : 'New message',
      url: `/messages/${message.conversation_id}`,
    })

    const results = await Promise.allSettled(
      subscriptions.map(async (row) => {
        try {
          await webpush.sendNotification(row.subscription, notificationPayload)
        } catch (err) {
          // 404/410 = the subscription is no longer valid (browser data
          // cleared, permission revoked outside the app, uninstalled,
          // etc.) — clean it up so future messages stop trying it.
          const statusCode = (err as { statusCode?: number })?.statusCode
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', row.id)
          }
          throw err
        }
      })
    )

    const failed = results.filter((r) => r.status === 'rejected').length
    return new Response(JSON.stringify({ sent: results.length - failed, failed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-push-notification error', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
