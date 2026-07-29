import { supabase } from './supabaseClient'

const ASSIGNMENT_SELECT =
  '*, assigned_running_segments(*, assigned_running_segment_reps(*)), assigned_swim_segments(*, assigned_swim_segment_reps(*)), assigned_bike_segments(*, assigned_bike_segment_reps(*)), assigned_other_segments(*, assigned_other_segment_reps(*)), assigned_lifting_targets(*)'

function sortAssignment(a) {
  a?.assigned_running_segments?.sort((x, y) => x.order_index - y.order_index)
  a?.assigned_running_segments?.forEach((seg) => seg.assigned_running_segment_reps?.sort((x, y) => x.rep_number - y.rep_number))
  a?.assigned_swim_segments?.sort((x, y) => x.order_index - y.order_index)
  a?.assigned_swim_segments?.forEach((seg) => seg.assigned_swim_segment_reps?.sort((x, y) => x.rep_number - y.rep_number))
  a?.assigned_bike_segments?.sort((x, y) => x.order_index - y.order_index)
  a?.assigned_bike_segments?.forEach((seg) => seg.assigned_bike_segment_reps?.sort((x, y) => x.rep_number - y.rep_number))
  a?.assigned_other_segments?.sort((x, y) => x.order_index - y.order_index)
  a?.assigned_other_segments?.forEach((seg) => seg.assigned_other_segment_reps?.sort((x, y) => x.rep_number - y.rep_number))
  return a
}

// Shared by every segment-based branch of createAssignment below — inserts
// each segment row, then one row per rep into its `repsTable`, mirroring
// insertRunningSegments/insertSwimSegments/insertBikeSegments/
// insertOtherSegments in src/lib/workouts.js (the actuals-side equivalent).
// The segment row's own target_time_* columns are also filled in from the
// first rep, purely as a harmless fallback for any code path that hasn't
// been updated to read the per-rep rows — nothing in this app relies on
// them once the reps exist.
async function insertAssignedSegmentsWithReps(segmentsTable, repsTable, assignedWorkoutId, segments) {
  const cleanSegments = (segments || []).filter((s) => s.distanceValue)

  for (let i = 0; i < cleanSegments.length; i++) {
    const seg = cleanSegments[i]
    const firstRep = seg.repTimes?.[0]
    const { data: segmentRow, error: segmentError } = await supabase
      .from(segmentsTable)
      .insert({
        assigned_workout_id: assignedWorkoutId,
        order_index: i,
        label: seg.label || null,
        distance_value: Number(seg.distanceValue),
        distance_unit: seg.distanceUnit,
        reps: Number(seg.reps) || 1,
        target_time_hours: firstRep?.hours || 0,
        target_time_minutes: firstRep?.minutes || 0,
        target_time_seconds: firstRep?.seconds || 0,
      })
      .select()
      .single()
    if (segmentError) throw segmentError

    const repRows = (seg.repTimes || []).map((t, idx) => ({
      segment_id: segmentRow.id,
      rep_number: idx + 1,
      target_time_hours: t.hours || 0,
      target_time_minutes: t.minutes || 0,
      target_time_seconds: t.seconds || 0,
    }))

    if (repRows.length > 0) {
      const { error: repsError } = await supabase.from(repsTable).insert(repRows)
      if (repsError) throw repsError
    }
  }
}

// `runningSegments`/`swimSegments`/`bikeSegments`/`otherSegments`: [{ label, distanceValue, distanceUnit, reps, repTimes: [{hours,minutes,seconds}, ...] }]
// — the exact same shape createWorkout's segments use, since a segment
// means the same thing whether it's an actual or a target.
export async function createAssignment({
  coachId,
  athleteId,
  type,
  date,
  notes,
  runningSegments,
  swimSegments,
  bikeSegments,
  otherSegments,
  liftingTargets,
}) {
  const { data: assignment, error } = await supabase
    .from('assigned_workouts')
    .insert({ coach_id: coachId, athlete_id: athleteId, type, date, notes: notes || null })
    .select()
    .single()
  if (error) throw error

  if (type === 'running' && runningSegments?.length) {
    await insertAssignedSegmentsWithReps('assigned_running_segments', 'assigned_running_segment_reps', assignment.id, runningSegments)
  }

  if (type === 'swim' && swimSegments?.length) {
    await insertAssignedSegmentsWithReps('assigned_swim_segments', 'assigned_swim_segment_reps', assignment.id, swimSegments)
  }

  if (type === 'bike' && bikeSegments?.length) {
    await insertAssignedSegmentsWithReps('assigned_bike_segments', 'assigned_bike_segment_reps', assignment.id, bikeSegments)
  }

  if (type === 'other' && otherSegments?.length) {
    await insertAssignedSegmentsWithReps('assigned_other_segments', 'assigned_other_segment_reps', assignment.id, otherSegments)
  }

  if (type === 'lifting' && liftingTargets?.length) {
    const rows = liftingTargets
      .filter((ex) => ex.exerciseName)
      .map((ex) => ({
        assigned_workout_id: assignment.id,
        exercise_name: ex.exerciseName,
        target_sets: ex.targetSets || null,
        target_reps: ex.targetReps || null,
        target_weight: ex.targetWeight || null,
      }))
    if (rows.length) {
      const { error: exError } = await supabase.from('assigned_lifting_targets').insert(rows)
      if (exError) throw exError
    }
  }

  return assignment
}

// startDate/endDate are optional "YYYY-MM-DD" bounds (inclusive) — omitted
// entirely, this behaves exactly as before (all-time, unfiltered). Mirrors
// fetchAssignmentsForCoach's date-range shape, used by WeeklyMileageSection
// to pull just the viewed week's assignments rather than an athlete's whole
// history.
export async function fetchAssignmentsForAthlete(athleteId, { startDate, endDate } = {}) {
  let query = supabase.from('assigned_workouts').select(ASSIGNMENT_SELECT).eq('athlete_id', athleteId)
  if (startDate) query = query.gte('date', startDate)
  if (endDate) query = query.lte('date', endDate)
  const { data, error } = await query.order('date', { ascending: false })
  if (error) throw error
  return data?.map(sortAssignment)
}

export async function fetchOpenAssignments(athleteId, type) {
  const { data, error } = await supabase
    .from('assigned_workouts')
    .select(ASSIGNMENT_SELECT)
    .eq('athlete_id', athleteId)
    .eq('type', type)
    .eq('status', 'assigned')
    .order('date', { ascending: true })
  if (error) throw error
  return data?.map(sortAssignment)
}

export async function fetchAssignmentById(id) {
  const { data, error } = await supabase.from('assigned_workouts').select(ASSIGNMENT_SELECT).eq('id', id).single()
  if (error) throw error
  return sortAssignment(data)
}

// startDate/endDate are optional "YYYY-MM-DD" bounds (inclusive) — omitted
// entirely, this behaves exactly as before (all-time, unfiltered, relies on
// RLS for team scoping). The assignment grid passes a rolling window;
// the flat list view keeps calling this with no arguments.
export async function fetchAssignmentsForCoach({ startDate, endDate } = {}) {
  let query = supabase
    .from('assigned_workouts')
    .select(`${ASSIGNMENT_SELECT}, profiles!assigned_workouts_athlete_id_fkey(name)`)
    .order('date', { ascending: false })
  if (startDate) query = query.gte('date', startDate)
  if (endDate) query = query.lte('date', endDate)
  const { data, error } = await query
  if (error) throw error
  return data?.map(sortAssignment)
}

// Coach-only; RLS already permits deleting the parent (children CASCADE for
// free). Used both for "edit" (delete + recreate, since child segment
// tables have no UPDATE/DELETE policy of their own) and for paste overwrite.
// Callers are responsible for warning first if the assignment being
// replaced has status 'completed' — the athlete's logged workout is kept,
// but its workouts.assignment_id gets set null (ON DELETE SET NULL), which
// permanently unlinks it from any assignment since there's no coach-write
// path to `workouts` to relink it afterward.
export async function deleteAssignment(id) {
  const { error } = await supabase.from('assigned_workouts').delete().eq('id', id)
  if (error) throw error
}

// Inverse of createAssignment's expected input shape — converts a fetched
// assignment's nested snake_case child rows back into the camelCase shape
// AssignmentForm/createAssignment use. Used both to pre-fill the edit form
// and to build a copy/paste clipboard entry's payload.
export function assignmentToFormPayload(assignment) {
  // Reads each rep's own target time back from its `repsField` child rows —
  // same `repTimes` shape SegmentEditor uses for actuals. Falls back to the
  // segment-level target_time_* columns (as a single rep) for a segment
  // saved before this per-rep rework existed, so an old assignment still
  // round-trips into something editable rather than an empty/broken time.
  const segWithReps = (list, repsField) =>
    (list || []).map((s) => {
      const repRows = s[repsField] || []
      const repTimes =
        repRows.length > 0
          ? repRows.map((r) => ({
              hours: r.target_time_hours,
              minutes: r.target_time_minutes,
              seconds: r.target_time_seconds,
            }))
          : [{ hours: s.target_time_hours, minutes: s.target_time_minutes, seconds: s.target_time_seconds }]
      return {
        key: crypto.randomUUID(),
        label: s.label || '',
        distanceValue: s.distance_value,
        distanceUnit: s.distance_unit,
        reps: s.reps,
        repTimes,
      }
    })

  return {
    type: assignment.type,
    notes: assignment.notes || '',
    runningSegments: segWithReps(assignment.assigned_running_segments, 'assigned_running_segment_reps'),
    swimSegments: segWithReps(assignment.assigned_swim_segments, 'assigned_swim_segment_reps'),
    bikeSegments: segWithReps(assignment.assigned_bike_segments, 'assigned_bike_segment_reps'),
    otherSegments: segWithReps(assignment.assigned_other_segments, 'assigned_other_segment_reps'),
    liftingTargets: (assignment.assigned_lifting_targets || []).map((t) => ({
      exerciseName: t.exercise_name,
      targetSets: t.target_sets ?? '',
      targetReps: t.target_reps ?? '',
      targetWeight: t.target_weight ?? '',
    })),
  }
}
