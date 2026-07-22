// Groups a day's assigned_workouts rows (one per athlete, as returned by
// fetchAssignmentsForCoach) by whether they're the *same* workout — same
// type, same segments/targets, same notes — regardless of which athletes
// they belong to. Used by the assignment-grid's "Export day" PDF flow so a
// coach who assigned one workout to a whole group doesn't have to review
// each athlete's row individually; the grouping is a client-side PDF-review
// step only and never writes anything back to assigned_workouts.

function segmentSignature(seg) {
  return {
    label: seg.label || '',
    distance_value: Number(seg.distance_value) || 0,
    distance_unit: seg.distance_unit,
    reps: seg.reps || 1,
    target_time_hours: seg.target_time_hours || 0,
    target_time_minutes: seg.target_time_minutes || 0,
    target_time_seconds: seg.target_time_seconds || 0,
  }
}

function liftingSignature(t) {
  return {
    exercise_name: t.exercise_name,
    target_sets: t.target_sets ?? null,
    target_reps: t.target_reps ?? null,
    target_weight: t.target_weight ?? null,
  }
}

// A JSON string that's identical for two assignments iff a coach would
// consider them "the same workout" — deliberately excludes id/athlete_id/
// coach_id/date/status/team_id, which differ per-athlete/row by design.
export function assignmentSignature(assignment) {
  return JSON.stringify({
    type: assignment.type,
    notes: (assignment.notes || '').trim(),
    running: (assignment.assigned_running_segments || []).map(segmentSignature),
    swim: (assignment.assigned_swim_segments || []).map(segmentSignature),
    bike: (assignment.assigned_bike_segments || []).map(segmentSignature),
    lifting: (assignment.assigned_lifting_targets || []).map(liftingSignature),
  })
}

// Returns groups in a stable initial order: first-seen-signature order,
// i.e. the order athletes appear in `assignments` determines which workout
// becomes "Group A" first — arbitrary but deterministic, and the coach can
// freely reorder from there.
export function groupAssignmentsByWorkout(assignments) {
  const order = []
  const bySignature = new Map()
  for (const a of assignments || []) {
    const sig = assignmentSignature(a)
    if (!bySignature.has(sig)) {
      bySignature.set(sig, [])
      order.push(sig)
    }
    bySignature.get(sig).push(a)
  }
  return order.map((sig) => ({ assignments: bySignature.get(sig) }))
}
