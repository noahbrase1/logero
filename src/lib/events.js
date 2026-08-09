import { supabase } from './supabaseClient'
import { parseEventDistance } from './meetResults'

export async function fetchEvents() {
  const { data, error } = await supabase.from('events').select('*').order('date', { ascending: true })
  if (error) throw error
  return data
}

export async function createEvent({ name, date, startTime, endTime, location, notes, category, createdBy }) {
  const { data, error } = await supabase
    .from('events')
    .insert({
      name,
      date,
      start_time: startTime || null,
      end_time: endTime || null,
      location,
      notes,
      category: category || 'other',
      created_by: createdBy,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEvent(id, { name, date, startTime, endTime, location, notes, category }) {
  const { data, error } = await supabase
    .from('events')
    .update({
      name,
      date,
      start_time: startTime || null,
      end_time: endTime || null,
      location,
      notes,
      category: category || 'other',
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw error
}

export async function fetchEventById(id) {
  const { data, error } = await supabase.from('events').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Meet lineup (event entries)
// ---------------------------------------------------------------------------

// workouts(...) is embedded via event_entry_athletes.workout_id's FK so
// RecordResultsPanel can prefill its segment editor from whatever was
// already recorded, not just the result_hours/minutes/seconds summary —
// see "Meet Results (Record Results mode)" in CLAUDE.md.
const ENTRY_SELECT =
  '*, event_entry_athletes(athlete_id, team_label, result_hours, result_minutes, result_seconds, result_centiseconds, workout_id, profiles(id, name), workouts(id, running_segments(*, running_segment_reps(*)))), event_entry_results(*)'

export async function fetchEventEntries(eventId) {
  const { data, error } = await supabase
    .from('event_entries')
    .select(ENTRY_SELECT)
    .eq('event_id', eventId)
    .order('order_index', { ascending: true })
  if (error) throw error
  return data
}

// `teams`: [{ label, athleteIds }]. A single team with no label is the
// common case (individual events, or a relay with only one squad) and
// stores team_label as null so the display stays a flat list.
function flattenTeams(teams) {
  const rows = []
  for (const team of teams) {
    const label = teams.length > 1 ? team.label || null : null
    for (const athleteId of team.athleteIds) {
      rows.push({ athlete_id: athleteId, team_label: label })
    }
  }
  return rows
}

// Keeps a lineup entry's roster in sync with each athlete's own assigned
// workout for the event's date — see sync_lineup_assignment_segments() in
// supabase/lineup_race_assignments_schema.sql for what this actually does
// (add/update/remove one target segment per athlete, never touching
// anything else on their assignment). Distance is resolved here, once,
// with the same fallback RecordResultsPanel's own segment editor already
// uses (parseEventDistance() || a nominal 1 meter), so a lineup entry's
// assigned segment and its eventual recorded result always agree.
async function syncLineupAssignments(entryId, eventDate, eventName, athleteIds) {
  const distance = eventName ? parseEventDistance(eventName) || { value: 1, unit: 'meters' } : null
  const { error } = await supabase.rpc('sync_lineup_assignment_segments', {
    p_entry_id: entryId,
    p_event_date: eventDate || null,
    p_distance_value: distance?.value ?? null,
    p_distance_unit: distance?.unit ?? null,
    p_label: eventName || null,
    p_athlete_ids: athleteIds,
  })
  if (error) throw error
}

export async function createEventEntry({ eventId, eventDate, eventName, scheduledTime, orderIndex, splitCount, teams }) {
  const { data: entry, error } = await supabase
    .from('event_entries')
    .insert({
      event_id: eventId,
      event_name: eventName,
      scheduled_time: scheduledTime || null,
      order_index: orderIndex,
      split_count: splitCount || null,
    })
    .select()
    .single()
  if (error) throw error

  const athleteRows = flattenTeams(teams)
  if (athleteRows.length > 0) {
    const rows = athleteRows.map((r) => ({ entry_id: entry.id, athlete_id: r.athlete_id, team_label: r.team_label }))
    const { error: athletesError } = await supabase.from('event_entry_athletes').insert(rows)
    if (athletesError) throw athletesError
  }

  const athleteIds = [...new Set(athleteRows.map((r) => r.athlete_id))]
  await syncLineupAssignments(entry.id, eventDate, eventName, athleteIds)

  return entry
}

// Replaces the athlete list wholesale (delete then re-insert) — same
// approach used for workout segments/exercises, simpler than diffing.
export async function updateEventEntry(id, { eventDate, eventName, scheduledTime, splitCount, teams }) {
  const { error } = await supabase
    .from('event_entries')
    .update({ event_name: eventName, scheduled_time: scheduledTime || null, split_count: splitCount || null })
    .eq('id', id)
  if (error) throw error

  const { error: deleteError } = await supabase.from('event_entry_athletes').delete().eq('entry_id', id)
  if (deleteError) throw deleteError

  const athleteRows = flattenTeams(teams)
  if (athleteRows.length > 0) {
    const rows = athleteRows.map((r) => ({ entry_id: id, athlete_id: r.athlete_id, team_label: r.team_label }))
    const { error: insertError } = await supabase.from('event_entry_athletes').insert(rows)
    if (insertError) throw insertError
  }

  const athleteIds = [...new Set(athleteRows.map((r) => r.athlete_id))]
  await syncLineupAssignments(id, eventDate, eventName, athleteIds)
}

// Drops every athlete's linked assignment segment for this entry (and any
// assignment left completely empty by that) before deleting the entry
// itself — see syncLineupAssignments above.
export async function deleteEventEntry(id) {
  await syncLineupAssignments(id, null, null, [])
  const { error } = await supabase.from('event_entries').delete().eq('id', id)
  if (error) throw error
}

// `orderedEntries`: entries in their new display order — persists each
// entry's index as its order_index.
export async function reorderEventEntries(orderedEntries) {
  await Promise.all(
    orderedEntries.map((entry, index) =>
      supabase.from('event_entries').update({ order_index: index }).eq('id', entry.id)
    )
  )
}
