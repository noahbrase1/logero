// send-daily-calendar-digest
//
// A scheduled (not webhook-triggered) Edge Function — meant to run once a
// day, in the morning. For every athlete on an active team, looks at
// *today's* date and combines their assigned_workouts (if any) with their
// team's events (if any) into one push notification. An athlete with
// neither today gets nothing (no empty "you have nothing today" ping).
// Independent of send-push-notification's message pushes — see
// ../../notification_preferences_schema.sql: this only sends to
// subscriptions with notify_calendar = true, exactly as message pushes only
// go to notify_messages = true ones, so a device can opt into either
// without the other.
//
// Timezone note: this app has no per-user/per-team timezone concept
// anywhere in its schema (every date is a plain "YYYY-MM-DD" string, always
// handled in whatever local time it was entered in — see CLAUDE.md). "Today"
// here is simply the UTC date at the moment this function runs, so the cron
// schedule below needs to be set at a UTC hour that lands in the morning for
// your team's actual timezone (e.g. 11:00 UTC ≈ 7am US Eastern during EDT).
// If a team ever spans multiple timezones this won't be right for all of
// them — there's no way to fix that without adding a timezone column
// somewhere first.
//
// Deploy:
//   supabase functions deploy send-daily-calendar-digest --no-verify-jwt
//
// --no-verify-jwt for the same reason as send-push-notification: whatever
// calls this on a schedule (see below) has no end-user JWT to attach.
//
// Scheduling: unlike send-push-notification (triggered by a Database
// Webhook on message INSERTs), there's no row-insert event to hook here —
// this needs to run on a timer. Supabase's Dashboard has a Cron Jobs panel
// (Database → Cron Jobs, or Integrations → Cron, depending on dashboard
// version) that schedules a `net.http_post` call to this function's URL on
// a cron expression (e.g. `0 11 * * *` for 11:00 UTC daily) — set that up by
// hand there; it isn't something this repo's SQL files create (same
// reasoning as the messages webhook: the underlying extensions/schema
// aren't guaranteed pre-provisioned, and the Dashboard flow handles that).
// Whatever mechanism you use to call this URL needs an Authorization header
// carrying this project's service-role key (or an anon key, given
// --no-verify-jwt) — the Cron Jobs UI has a field for this.
//
// Secrets required: same VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT as
// send-push-notification (already set, if that function is deployed) —
// Edge Function secrets are shared across all functions in a project, not
// set per-function.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:no-reply@example.com'

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

const supabase = createClient(supabaseUrl, serviceRoleKey)

function unitAbbrev(unit: string) {
  if (unit === 'meters') return 'm'
  if (unit === 'km') return 'km'
  if (unit === 'yards') return 'yd'
  return 'mi'
}

function workoutTypeLabel(type: string) {
  if (type === 'running') return 'Running'
  if (type === 'swim') return 'Swimming'
  if (type === 'bike') return 'Cycling'
  if (type === 'lifting') return 'Lifting'
  return type
}

// A short, plain-text rendering of one assignment's target segments/
// exercises — deliberately simpler than the app's own summarizeAssignment()
// (src/utils/format.js), since a push notification body has no room for
// per-segment target times and this function has no easy way to share code
// with the browser bundle.
function summarizeAssignment(a: Record<string, unknown>): string {
  const segmentsByType: Record<string, unknown> = {
    running: a.assigned_running_segments,
    swim: a.assigned_swim_segments,
    bike: a.assigned_bike_segments,
  }
  const segments = segmentsByType[a.type as string] as
    | { reps?: number; distance_value: number; distance_unit: string }[]
    | undefined

  if (segments && segments.length > 0) {
    return segments
      .map((s) => `${s.reps && s.reps > 1 ? `${s.reps}x` : ''}${s.distance_value}${unitAbbrev(s.distance_unit)}`)
      .join(', ')
  }

  const liftingTargets = a.assigned_lifting_targets as { exercise_name: string }[] | undefined
  if (liftingTargets && liftingTargets.length > 0) {
    return liftingTargets.map((t) => t.exercise_name).join(', ')
  }

  return (a.notes as string) || `${workoutTypeLabel(a.type as string)} workout`
}

function formatTime(timeStr: string | null) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

Deno.serve(async (_req) => {
  try {
    const today = new Date().toISOString().slice(0, 10)

    const { data: athletes, error: athletesError } = await supabase
      .from('profiles')
      .select('id, team_id, teams!inner(status)')
      .eq('role', 'athlete')
      .eq('teams.status', 'active')

    if (athletesError) throw athletesError
    if (!athletes || athletes.length === 0) {
      return new Response('no athletes', { status: 200 })
    }

    const athleteIds = athletes.map((a) => a.id)
    const teamIds = [...new Set(athletes.map((a) => a.team_id))]

    const [
      { data: assignments, error: assignmentsError },
      { data: events, error: eventsError },
      { data: subscriptions, error: subsError },
    ] = await Promise.all([
      supabase
        .from('assigned_workouts')
        .select(
          'athlete_id, type, notes, assigned_running_segments(*), assigned_swim_segments(*), assigned_bike_segments(*), assigned_lifting_targets(*)'
        )
        .in('athlete_id', athleteIds)
        .eq('date', today),
      supabase.from('events').select('team_id, name, start_time').in('team_id', teamIds).eq('date', today),
      supabase
        .from('push_subscriptions')
        .select('id, user_id, subscription')
        .in('user_id', athleteIds)
        .eq('notify_calendar', true),
    ])

    if (assignmentsError) throw assignmentsError
    if (eventsError) throw eventsError
    if (subsError) throw subsError

    if (!subscriptions || subscriptions.length === 0) {
      return new Response('no opted-in athletes', { status: 200 })
    }

    const assignmentsByAthlete = new Map<string, Record<string, unknown>[]>()
    for (const a of assignments || []) {
      const list = assignmentsByAthlete.get(a.athlete_id) || []
      list.push(a)
      assignmentsByAthlete.set(a.athlete_id, list)
    }

    const eventsByTeam = new Map<string, { name: string; start_time: string | null }[]>()
    for (const e of events || []) {
      const list = eventsByTeam.get(e.team_id) || []
      list.push(e)
      eventsByTeam.set(e.team_id, list)
    }

    const subsByAthlete = new Map<string, { id: string; subscription: unknown }[]>()
    for (const s of subscriptions) {
      const list = subsByAthlete.get(s.user_id) || []
      list.push(s)
      subsByAthlete.set(s.user_id, list)
    }

    const jobs: Promise<void>[] = []
    let athletesNotified = 0

    for (const athlete of athletes) {
      const athleteSubs = subsByAthlete.get(athlete.id)
      if (!athleteSubs || athleteSubs.length === 0) continue

      const todaysAssignments = assignmentsByAthlete.get(athlete.id) || []
      const todaysEvents = eventsByTeam.get(athlete.team_id) || []
      if (todaysAssignments.length === 0 && todaysEvents.length === 0) continue

      const lines: string[] = []
      for (const a of todaysAssignments) {
        lines.push(`${workoutTypeLabel(a.type as string)}: ${summarizeAssignment(a)}`)
      }
      for (const e of todaysEvents) {
        const time = formatTime(e.start_time)
        lines.push(`Event: ${e.name}${time ? ` at ${time}` : ''}`)
      }

      const notificationPayload = JSON.stringify({
        title: "Today's plan",
        body: lines.join(' · '),
        url: '/',
      })

      athletesNotified++
      for (const sub of athleteSubs) {
        jobs.push(
          (async () => {
            try {
              await webpush.sendNotification(sub.subscription, notificationPayload)
            } catch (err) {
              // 404/410 = the subscription is no longer valid — clean it up
              // so future digests/messages stop trying it.
              const statusCode = (err as { statusCode?: number })?.statusCode
              if (statusCode === 404 || statusCode === 410) {
                await supabase.from('push_subscriptions').delete().eq('id', sub.id)
              }
              throw err
            }
          })()
        )
      }
    }

    const results = await Promise.allSettled(jobs)
    const failed = results.filter((r) => r.status === 'rejected').length
    return new Response(
      JSON.stringify({ athletesNotified, sent: results.length - failed, failed }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('send-daily-calendar-digest error', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
