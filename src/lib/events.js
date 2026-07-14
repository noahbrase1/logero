import { supabase } from './supabaseClient'

export async function fetchEvents() {
  const { data, error } = await supabase.from('events').select('*').order('date', { ascending: true })
  if (error) throw error
  return data
}

export async function createEvent({ name, date, startTime, endTime, location, notes, createdBy }) {
  const { data, error } = await supabase
    .from('events')
    .insert({
      name,
      date,
      start_time: startTime || null,
      end_time: endTime || null,
      location,
      notes,
      created_by: createdBy,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEvent(id, { name, date, startTime, endTime, location, notes }) {
  const { data, error } = await supabase
    .from('events')
    .update({ name, date, start_time: startTime || null, end_time: endTime || null, location, notes })
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

const ENTRY_SELECT = '*, event_entry_athletes(athlete_id, team_label, profiles(id, name))'

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

export async function createEventEntry({ eventId, eventName, scheduledTime, orderIndex, teams }) {
  const { data: entry, error } = await supabase
    .from('event_entries')
    .insert({
      event_id: eventId,
      event_name: eventName,
      scheduled_time: scheduledTime || null,
      order_index: orderIndex,
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

  return entry
}

// Replaces the athlete list wholesale (delete then re-insert) — same
// approach used for workout segments/exercises, simpler than diffing.
export async function updateEventEntry(id, { eventName, scheduledTime, teams }) {
  const { error } = await supabase
    .from('event_entries')
    .update({ event_name: eventName, scheduled_time: scheduledTime || null })
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
}

export async function deleteEventEntry(id) {
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
