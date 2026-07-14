import { supabase } from './supabaseClient'

const ASSIGNMENT_SELECT =
  '*, assigned_running_segments(*), assigned_swim_segments(*), assigned_bike_segments(*), assigned_lifting_targets(*)'

function sortAssignment(a) {
  a?.assigned_running_segments?.sort((x, y) => x.order_index - y.order_index)
  a?.assigned_swim_segments?.sort((x, y) => x.order_index - y.order_index)
  a?.assigned_bike_segments?.sort((x, y) => x.order_index - y.order_index)
  return a
}

// `runningSegments`/`swimSegments`/`bikeSegments`: [{ label, distanceValue, distanceUnit, reps, targetTime: {hours,minutes,seconds} }]
export async function createAssignment({
  coachId,
  athleteId,
  type,
  date,
  notes,
  runningSegments,
  swimSegments,
  bikeSegments,
  liftingTargets,
}) {
  const { data: assignment, error } = await supabase
    .from('assigned_workouts')
    .insert({ coach_id: coachId, athlete_id: athleteId, type, date, notes: notes || null })
    .select()
    .single()
  if (error) throw error

  if (type === 'running' && runningSegments?.length) {
    const cleanSegments = runningSegments.filter((s) => s.distanceValue)
    for (let i = 0; i < cleanSegments.length; i++) {
      const seg = cleanSegments[i]
      const { error: segmentError } = await supabase.from('assigned_running_segments').insert({
        assigned_workout_id: assignment.id,
        order_index: i,
        label: seg.label || null,
        distance_value: Number(seg.distanceValue),
        distance_unit: seg.distanceUnit,
        reps: Number(seg.reps) || 1,
        target_time_hours: seg.targetTime?.hours || 0,
        target_time_minutes: seg.targetTime?.minutes || 0,
        target_time_seconds: seg.targetTime?.seconds || 0,
      })
      if (segmentError) throw segmentError
    }
  }

  if (type === 'swim' && swimSegments?.length) {
    const cleanSegments = swimSegments.filter((s) => s.distanceValue)
    for (let i = 0; i < cleanSegments.length; i++) {
      const seg = cleanSegments[i]
      const { error: segmentError } = await supabase.from('assigned_swim_segments').insert({
        assigned_workout_id: assignment.id,
        order_index: i,
        label: seg.label || null,
        distance_value: Number(seg.distanceValue),
        distance_unit: seg.distanceUnit,
        reps: Number(seg.reps) || 1,
        target_time_hours: seg.targetTime?.hours || 0,
        target_time_minutes: seg.targetTime?.minutes || 0,
        target_time_seconds: seg.targetTime?.seconds || 0,
      })
      if (segmentError) throw segmentError
    }
  }

  if (type === 'bike' && bikeSegments?.length) {
    const cleanSegments = bikeSegments.filter((s) => s.distanceValue)
    for (let i = 0; i < cleanSegments.length; i++) {
      const seg = cleanSegments[i]
      const { error: segmentError } = await supabase.from('assigned_bike_segments').insert({
        assigned_workout_id: assignment.id,
        order_index: i,
        label: seg.label || null,
        distance_value: Number(seg.distanceValue),
        distance_unit: seg.distanceUnit,
        reps: Number(seg.reps) || 1,
        target_time_hours: seg.targetTime?.hours || 0,
        target_time_minutes: seg.targetTime?.minutes || 0,
        target_time_seconds: seg.targetTime?.seconds || 0,
      })
      if (segmentError) throw segmentError
    }
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

export async function fetchAssignmentsForAthlete(athleteId) {
  const { data, error } = await supabase
    .from('assigned_workouts')
    .select(ASSIGNMENT_SELECT)
    .eq('athlete_id', athleteId)
    .order('date', { ascending: false })
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

export async function fetchAssignmentsForCoach() {
  const { data, error } = await supabase
    .from('assigned_workouts')
    .select(`${ASSIGNMENT_SELECT}, profiles!assigned_workouts_athlete_id_fkey(name)`)
    .order('date', { ascending: false })
  if (error) throw error
  return data?.map(sortAssignment)
}
