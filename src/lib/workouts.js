import { supabase } from './supabaseClient'

// ---------------------------------------------------------------------------
// Creating workouts
// ---------------------------------------------------------------------------

// A quick note is a bare `workouts` row: date + free text in `notes`, no
// segments/exercises. Athletes and coaches can both post one (see
// quick_notes_schema.sql for the RLS that allows a coach to insert here).
export async function createQuickNote({ userId, date, content }) {
  const { data, error } = await supabase
    .from('workouts')
    .insert({
      user_id: userId,
      date,
      type: 'note',
      name: null,
      notes: content,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// `segments`: [{ label, distanceValue, distanceUnit, reps, repTimes: [{hours,minutes,seconds}, ...] }]
// Inserted one at a time (workout lists are short) so each segment's
// generated id is available before inserting its rep rows.
async function insertRunningSegments(workoutId, segments) {
  const cleanSegments = (segments || []).filter((s) => s.distanceValue)

  for (let i = 0; i < cleanSegments.length; i++) {
    const seg = cleanSegments[i]
    const { data: segmentRow, error: segmentError } = await supabase
      .from('running_segments')
      .insert({
        workout_id: workoutId,
        order_index: i,
        label: seg.label || null,
        distance_value: Number(seg.distanceValue),
        distance_unit: seg.distanceUnit,
        reps: Number(seg.reps) || 1,
      })
      .select()
      .single()

    if (segmentError) throw segmentError

    const repRows = (seg.repTimes || []).map((t, idx) => ({
      segment_id: segmentRow.id,
      rep_number: idx + 1,
      time_hours: t.hours || 0,
      time_minutes: t.minutes || 0,
      time_seconds: t.seconds || 0,
    }))

    if (repRows.length > 0) {
      const { error: repsError } = await supabase.from('running_segment_reps').insert(repRows)
      if (repsError) throw repsError
    }
  }
}

// `segments`: [{ label, distanceValue, distanceUnit, reps, repTimes: [{hours,minutes,seconds}, ...] }]
async function insertSwimSegments(workoutId, segments) {
  const cleanSegments = (segments || []).filter((s) => s.distanceValue)

  for (let i = 0; i < cleanSegments.length; i++) {
    const seg = cleanSegments[i]
    const { data: segmentRow, error: segmentError } = await supabase
      .from('swim_segments')
      .insert({
        workout_id: workoutId,
        order_index: i,
        label: seg.label || null,
        distance_value: Number(seg.distanceValue),
        distance_unit: seg.distanceUnit,
        reps: Number(seg.reps) || 1,
      })
      .select()
      .single()

    if (segmentError) throw segmentError

    const repRows = (seg.repTimes || []).map((t, idx) => ({
      segment_id: segmentRow.id,
      rep_number: idx + 1,
      time_hours: t.hours || 0,
      time_minutes: t.minutes || 0,
      time_seconds: t.seconds || 0,
    }))

    if (repRows.length > 0) {
      const { error: repsError } = await supabase.from('swim_segment_reps').insert(repRows)
      if (repsError) throw repsError
    }
  }
}

// `segments`: [{ label, distanceValue, distanceUnit, reps, repTimes: [{hours,minutes,seconds,avgWatts,avgCadence}, ...] }]
// avgWatts/avgCadence are optional — an empty string (not yet typed, or
// deliberately left blank) is stored as null, never coerced to 0.
async function insertBikeSegments(workoutId, segments) {
  const cleanSegments = (segments || []).filter((s) => s.distanceValue)

  for (let i = 0; i < cleanSegments.length; i++) {
    const seg = cleanSegments[i]
    const { data: segmentRow, error: segmentError } = await supabase
      .from('bike_segments')
      .insert({
        workout_id: workoutId,
        order_index: i,
        label: seg.label || null,
        distance_value: Number(seg.distanceValue),
        distance_unit: seg.distanceUnit,
        reps: Number(seg.reps) || 1,
      })
      .select()
      .single()

    if (segmentError) throw segmentError

    const repRows = (seg.repTimes || []).map((t, idx) => ({
      segment_id: segmentRow.id,
      rep_number: idx + 1,
      time_hours: t.hours || 0,
      time_minutes: t.minutes || 0,
      time_seconds: t.seconds || 0,
      avg_watts: t.avgWatts !== '' && t.avgWatts != null ? Number(t.avgWatts) : null,
      avg_cadence: t.avgCadence !== '' && t.avgCadence != null ? Number(t.avgCadence) : null,
    }))

    if (repRows.length > 0) {
      const { error: repsError } = await supabase.from('bike_segment_reps').insert(repRows)
      if (repsError) throw repsError
    }
  }
}

async function insertLiftingExercises(workoutId, exercises) {
  const cleanExercises = (exercises || []).filter((ex) => ex.exerciseName)
  if (cleanExercises.length === 0) return

  const { error } = await supabase.from('lifting_exercises').insert(
    cleanExercises.map((ex) => ({
      workout_id: workoutId,
      exercise_name: ex.exerciseName,
      sets: ex.sets || null,
      reps: ex.reps || null,
      weight: ex.weight || null,
    }))
  )
  if (error) throw error
}

export async function createRunningWorkout({ userId, date, name, totalDistance, totalDurationSeconds, perceivedEffort, notes, segments, assignmentId }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .insert({
      user_id: userId,
      date,
      type: 'running',
      name,
      total_distance: totalDistance,
      total_duration_seconds: totalDurationSeconds,
      perceived_effort: perceivedEffort,
      notes,
      assignment_id: assignmentId || null,
    })
    .select()
    .single()

  if (workoutError) throw workoutError

  await insertRunningSegments(workout.id, segments)
  return workout
}

export async function createSwimWorkout({ userId, date, name, perceivedEffort, notes, segments, assignmentId }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .insert({
      user_id: userId,
      date,
      type: 'swim',
      name,
      perceived_effort: perceivedEffort,
      notes,
      assignment_id: assignmentId || null,
    })
    .select()
    .single()

  if (workoutError) throw workoutError

  await insertSwimSegments(workout.id, segments)
  return workout
}

export async function createBikeWorkout({ userId, date, name, perceivedEffort, notes, segments, assignmentId }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .insert({
      user_id: userId,
      date,
      type: 'bike',
      name,
      perceived_effort: perceivedEffort,
      notes,
      assignment_id: assignmentId || null,
    })
    .select()
    .single()

  if (workoutError) throw workoutError

  await insertBikeSegments(workout.id, segments)
  return workout
}

export async function createLiftingWorkout({ userId, date, name, perceivedEffort, notes, exercises, assignmentId }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .insert({
      user_id: userId,
      date,
      type: 'lifting',
      name,
      perceived_effort: perceivedEffort,
      notes,
      assignment_id: assignmentId || null,
    })
    .select()
    .single()

  if (workoutError) throw workoutError

  await insertLiftingExercises(workout.id, exercises)
  return workout
}

// ---------------------------------------------------------------------------
// Editing workouts — replaces child rows wholesale (delete then re-insert)
// rather than diffing individual segments/exercises, mirroring how they're
// created in the first place and keeping order_index simple to get right.
// ---------------------------------------------------------------------------

export async function updateQuickNote(id, { date, content }) {
  const { data, error } = await supabase
    .from('workouts')
    .update({ date, notes: content })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateRunningWorkout(id, { date, name, totalDistance, totalDurationSeconds, perceivedEffort, notes, segments }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .update({
      date,
      name,
      total_distance: totalDistance,
      total_duration_seconds: totalDurationSeconds,
      perceived_effort: perceivedEffort,
      notes,
    })
    .eq('id', id)
    .select()
    .single()
  if (workoutError) throw workoutError

  const { error: deleteError } = await supabase.from('running_segments').delete().eq('workout_id', id)
  if (deleteError) throw deleteError

  await insertRunningSegments(id, segments)
  return workout
}

export async function updateSwimWorkout(id, { date, name, perceivedEffort, notes, segments }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .update({ date, name, perceived_effort: perceivedEffort, notes })
    .eq('id', id)
    .select()
    .single()
  if (workoutError) throw workoutError

  const { error: deleteError } = await supabase.from('swim_segments').delete().eq('workout_id', id)
  if (deleteError) throw deleteError

  await insertSwimSegments(id, segments)
  return workout
}

export async function updateBikeWorkout(id, { date, name, perceivedEffort, notes, segments }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .update({ date, name, perceived_effort: perceivedEffort, notes })
    .eq('id', id)
    .select()
    .single()
  if (workoutError) throw workoutError

  const { error: deleteError } = await supabase.from('bike_segments').delete().eq('workout_id', id)
  if (deleteError) throw deleteError

  await insertBikeSegments(id, segments)
  return workout
}

export async function updateLiftingWorkout(id, { date, name, perceivedEffort, notes, exercises }) {
  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .update({ date, name, perceived_effort: perceivedEffort, notes })
    .eq('id', id)
    .select()
    .single()
  if (workoutError) throw workoutError

  const { error: deleteError } = await supabase.from('lifting_exercises').delete().eq('workout_id', id)
  if (deleteError) throw deleteError

  await insertLiftingExercises(id, exercises)
  return workout
}

// ---------------------------------------------------------------------------
// Reading workouts
// ---------------------------------------------------------------------------

const WORKOUT_SELECT =
  '*, running_segments(*, running_segment_reps(*)), swim_segments(*, swim_segment_reps(*)), bike_segments(*, bike_segment_reps(*)), lifting_exercises(*), assigned_workouts(*, assigned_running_segments(*), assigned_swim_segments(*), assigned_bike_segments(*), assigned_lifting_targets(*))'

export async function fetchWorkouts({ userId, type, startDate, endDate } = {}) {
  // Sort by submission time, not just the logged date — otherwise two
  // workouts logged for the same calendar date tie and fall back to
  // whatever order the database happens to return them in.
  let query = supabase.from('workouts').select(WORKOUT_SELECT).order('created_at', { ascending: false })

  if (userId) query = query.eq('user_id', userId)
  if (type) query = query.eq('type', type)
  if (startDate) query = query.gte('date', startDate)
  if (endDate) query = query.lte('date', endDate)

  const { data, error } = await query
  if (error) throw error

  data?.forEach(sortWorkoutNested)
  return data
}

export async function fetchWorkoutById(id) {
  const { data, error } = await supabase.from('workouts').select(WORKOUT_SELECT).eq('id', id).single()
  if (error) throw error
  sortWorkoutNested(data)
  return data
}

function sortWorkoutNested(w) {
  w.running_segments?.sort((a, b) => a.order_index - b.order_index)
  w.running_segments?.forEach((seg) => seg.running_segment_reps?.sort((a, b) => a.rep_number - b.rep_number))
  w.swim_segments?.sort((a, b) => a.order_index - b.order_index)
  w.swim_segments?.forEach((seg) => seg.swim_segment_reps?.sort((a, b) => a.rep_number - b.rep_number))
  w.bike_segments?.sort((a, b) => a.order_index - b.order_index)
  w.bike_segments?.forEach((seg) => seg.bike_segment_reps?.sort((a, b) => a.rep_number - b.rep_number))
  w.assigned_workouts?.assigned_running_segments?.sort((a, b) => a.order_index - b.order_index)
  w.assigned_workouts?.assigned_swim_segments?.sort((a, b) => a.order_index - b.order_index)
  w.assigned_workouts?.assigned_bike_segments?.sort((a, b) => a.order_index - b.order_index)
}

// !inner forces the join so .neq('profiles.role', ...) can actually filter
// on it — a removed athlete's own logs are preserved (see AthleteDetailPage/
// FormerAthletesPage) but excluded from the active team-wide feed. Doesn't
// restrict to role='athlete' specifically since coach-authored quick notes
// belong in this feed too — only 'removed' is excluded.
export async function fetchRecentTeamFeed(limit = 20) {
  const { data, error } = await supabase
    .from('workouts')
    .select(`${WORKOUT_SELECT}, profiles!inner(name, role)`)
    .neq('profiles.role', 'removed')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  data?.forEach(sortWorkoutNested)
  return data
}

// ---------------------------------------------------------------------------
// Profiles / roster / approvals
// ---------------------------------------------------------------------------

export async function fetchPendingProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function fetchApprovedAthletes() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'athlete')
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

// Roster display: athletes *and* admins (read-only athletic directors) show
// up on the roster page. Kept separate from fetchApprovedAthletes(), which
// stays athlete-only since it also backs athlete-picker UI (DM/group/
// assignment/lineup targets) where an admin isn't a valid pick.
export async function fetchTeamRoster() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['athlete', 'admin'])
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function fetchCoaches() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'coach')
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

export async function fetchRemovedAthletes() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'removed')
    .order('name', { ascending: true })
  if (error) throw error
  return data
}

// Soft-removes an athlete: flips their role to 'removed' (revoking their own
// access) and drops them from the team channel and any groups, all inside a
// SECURITY DEFINER RPC — see remove_athlete_schema.sql for why this can't be
// a plain client-side update + delete.
export async function removeAthlete(athleteId) {
  const { error } = await supabase.rpc('remove_athlete', { target_id: athleteId })
  if (error) throw error
}

// Reverses a removal: flips role back to 'athlete'. This is a plain update
// (not an RPC) because profiles_update_coach_only already lets a coach set
// any role on any of their team's profiles — the same policy approveProfile()
// below relies on. The existing on_profile_approved_join_team trigger fires
// on this exact role transition and re-adds them to the team channel for
// free. Their workout logs were never touched by removal, so they simply
// reappear in the active feed once fetchRecentTeamFeed's role filter no
// longer excludes them. Their deleted messages are NOT restored — that
// deletion was permanent by design.
export async function reinstateAthlete(athleteId) {
  const { error } = await supabase.from('profiles').update({ role: 'athlete' }).eq('id', athleteId)
  if (error) throw error
}

export async function approveProfile(profileId, role, approvedBy) {
  const { error } = await supabase
    .from('profiles')
    .update({ role, approved_by: approvedBy })
    .eq('id', profileId)
  if (error) throw error
}

// Deletes a pending signup's account outright (not a soft-remove) — see
// reject_pending_delete_schema.sql for why: a pending user never had a
// chance to create anything worth archiving, and keeping the auth.users row
// around would permanently block that email from signing up again, since
// Supabase enforces email uniqueness at the auth level regardless of
// profiles.role.
export async function rejectProfile(profileId) {
  const { error } = await supabase.rpc('reject_pending_profile', { target_id: profileId })
  if (error) throw error
}

export async function fetchProfile(profileId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', profileId).single()
  if (error) throw error
  return data
}
