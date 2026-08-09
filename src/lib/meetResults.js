import { supabase } from './supabaseClient'

const UNIT_ALIASES = {
  m: 'meters',
  meter: 'meters',
  meters: 'meters',
  km: 'km',
  kilometer: 'km',
  kilometers: 'km',
  mi: 'miles',
  mile: 'miles',
  miles: 'miles',
}

// Best-effort distance guess from a lineup entry's free-text event name
// ("800m" -> 800 meters, "2 Mile" -> 2 miles, "5K" -> 5 km, "4x400m Relay"
// -> 400 meters, the per-leg distance) — event_entries has no structured
// distance field, only event_name, so a meet result has nothing else to
// build a running_segments row from. Returns null for a name with no
// recognizable distance (a relay's own team name, or a field event like
// "Long Jump") — callers fall back to a nominal 1 meter in that case (see
// supabase/meet_results_schema.sql for why that's an acceptable trade-off
// rather than blocking the whole feature on it).
export function parseEventDistance(eventName) {
  if (!eventName) return null
  const name = eventName.trim()

  const mileWord = name.match(/^(\d+(?:\.\d+)?)?\s*miles?$/i)
  if (mileWord) return { value: mileWord[1] ? parseFloat(mileWord[1]) : 1, unit: 'miles' }

  const match = name.match(/(\d+(?:\.\d+)?)\s*(kilometers?|km|meters?|m|miles?|mi)\b/i)
  if (match) {
    const value = parseFloat(match[1])
    const unit = UNIT_ALIASES[match[2].toLowerCase()]
    if (unit && value > 0) return { value, unit }
  }

  const kShort = name.match(/(\d+(?:\.\d+)?)\s*k\b/i)
  if (kShort) return { value: parseFloat(kShort[1]), unit: 'km' }

  // No unit at all in the name ("1500", "800", "4x400 Relay") — very
  // common in practice, since everyone already knows a bare track-event
  // number means meters. Takes the LARGEST number found rather than the
  // first, so a relay's squad-size prefix ("4x400" -> 4 and 400) or a heat
  // label ("Heat 2 - 400" -> 2 and 400) doesn't get mistaken for the
  // distance itself.
  const bareNumbers = [...name.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]))
  if (bareNumbers.length > 0) {
    const value = Math.max(...bareNumbers)
    if (value > 0) return { value, unit: 'meters' }
  }

  return null
}

const METERS_PER_UNIT = { meters: 1, km: 1000, miles: 1609.344 }

// Seeds an even-ish split template from a race's total distance and a
// coach-chosen split count (event_entries.split_count) — e.g. 1500m over 4
// splits -> 400m×3 + 300m, 5000m over 13 -> 400m×12 + 200m. Always works in
// meters regardless of the race's own parsed unit, since splits are called
// out in meters even for a mile/km-labeled race. Not a literal even
// division (1500/4 = 375m flat, which nobody actually splits at) — instead
// rounds the target interval to the nearest 100m first (the way a coach
// actually thinks about it: "about 4 splits" on a 1500m means 400m reps
// with whatever's left over at the end), then fits as many full reps of
// that rounded size as possible, with the remainder as a final shorter
// segment. Returns null when there's nothing sensible to build (no
// distance, no split count, or splitCount < 1). Collapses consecutive
// equal-size splits into one segment with a `reps` count rather than N
// separate one-rep segments — the same convention every other interval
// workout in this app already uses (e.g. "4x400m"), per the request that
// this look like an ordinary workout's splits, not something new.
export function computeEvenSplitSegments(distanceValue, distanceUnit, splitCount) {
  const totalMeters = Number(distanceValue) * (METERS_PER_UNIT[distanceUnit] || 1)
  if (!totalMeters || totalMeters <= 0 || !splitCount || splitCount < 1) return null

  const rawSize = totalMeters / splitCount
  const roundedSize = Math.max(100, Math.round(rawSize / 100) * 100)
  const fullReps = Math.floor(totalMeters / roundedSize)
  const remainder = Math.round((totalMeters - fullReps * roundedSize) * 100) / 100

  // A remainder under ~50m (e.g. the 9m left over splitting a 1609.344m
  // mile into 400s) isn't a real interval anyone would time as its own
  // split — nobody stops a watch for the last 9 meters of a mile — so it's
  // dropped rather than surfaced as a near-zero segment.
  const MIN_REMAINDER_METERS = 50

  const segments = []
  if (fullReps > 0) segments.push({ distanceValue: roundedSize, distanceUnit: 'meters', reps: fullReps })
  if (remainder >= MIN_REMAINDER_METERS) segments.push({ distanceValue: remainder, distanceUnit: 'meters', reps: 1 })
  return segments.length > 0 ? segments : null
}

// Drops any segment with no distance entered (mirrors insertRunningSegments'
// own `.filter((s) => s.distanceValue)` in src/lib/workouts.js) and converts
// SegmentEditor's camelCase shape into the RPC's snake_case jsonb shape.
// Doesn't drop individual zero-time reps within a kept segment — same as an
// ordinary LogWorkoutForm submission, which stores a 0:00 rep as-is and
// lets the display layer (formatRepTimesList, sumLoggedTimeSeconds's
// all-or-nothing rule) decide what that means, rather than silently
// compacting the array and losing which interval was actually missed.
function cleanSegments(segments) {
  return (segments || [])
    .filter((s) => s.distanceValue)
    .map((s) => ({
      label: s.label || null,
      distance_value: Number(s.distanceValue),
      distance_unit: s.distanceUnit,
      rep_times: (s.repTimes || []).map((t) => ({
        hours: t.hours || 0,
        minutes: t.minutes || 0,
        seconds: t.seconds || 0,
        centiseconds: t.centiseconds || 0,
      })),
    }))
}

// Builds the single-segment/single-rep shape used for a relay's team result
// or an individual leg split, which are always one flat time rather than a
// coach-editable interval breakdown.
export function singleSegmentFromTime(time, distance) {
  return [
    {
      distanceValue: distance.value,
      distanceUnit: distance.unit,
      reps: 1,
      repTimes: [time],
    },
  ]
}

// Coach-only: create/update/clear one athlete's individual meet result (a
// solo event, or one relay leg split — both go through this same path) via
// the record_meet_result SECURITY DEFINER RPC — same reason
// record_split_recorder_entry() exists (see supabase/split_recorder_schema.sql):
// a coach has no RLS write path into another athlete's `workouts` row.
// `segments` is the same shape SegmentEditor/RunningSegmentsEditor already
// produce ([{label, distanceValue, distanceUnit, reps, repTimes}]) — a race
// is rarely one flat time; splits are usually taken at intervals (every
// 400m, every 200m, an irregular tail segment), so this takes a full
// segment/rep breakdown rather than a single time, the exact shape
// LogWorkoutForm already uses for a normal running log. An empty array (or
// one whose only segment has no distance entered) clears any previously
// recorded result instead of saving one.
export async function recordIndividualResult({ entryId, athleteId, name, notes, segments }) {
  const { data, error } = await supabase.rpc('record_meet_result', {
    p_entry_id: entryId,
    p_athlete_id: athleteId,
    p_name: name,
    p_notes: notes || null,
    p_segments: cleanSegments(segments),
  })
  if (error) throw error
  return data
}

// Team-level relay result — never creates a per-athlete log (see
// supabase/meet_results_schema.sql's header comment for why an unsplit
// relay time shouldn't be attributed to any one athlete's own log). A plain
// RLS-gated upsert, not an RPC — event_entry_results is coach-owned, never
// another user's row. `time` all-zero deletes the row instead of leaving a
// stale 0:00 result behind.
export async function saveTeamResult({ entryId, teamLabel, time }) {
  const { hours = 0, minutes = 0, seconds = 0, centiseconds = 0 } = time || {}
  const label = teamLabel || null

  if (hours === 0 && minutes === 0 && seconds === 0 && centiseconds === 0) {
    let query = supabase.from('event_entry_results').delete().eq('entry_id', entryId)
    query = label ? query.eq('team_label', label) : query.is('team_label', null)
    const { error } = await query
    if (error) throw error
    return null
  }

  const { data, error } = await supabase
    .from('event_entry_results')
    .upsert(
      {
        entry_id: entryId,
        team_label: label,
        result_hours: hours,
        result_minutes: minutes,
        result_seconds: seconds,
        result_centiseconds: centiseconds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entry_id,team_label_key' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}
