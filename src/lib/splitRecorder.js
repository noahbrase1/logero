import { supabase } from './supabaseClient'

// Coach-only: create-or-update one athlete's recorded-splits log for a day,
// via the record_split_recorder_entry SECURITY DEFINER RPC (see
// supabase/split_recorder_schema.sql for why this can't be a plain client
// insert — a coach has no RLS write path into another athlete's `workouts`
// row for any type but 'note'). `segments`: [{label, distanceValue,
// distanceUnit, repTimes: [{hours,minutes,seconds}, ...]}, ...] — already
// trimmed to just the segments/reps the coach actually filled in for this
// athlete.
export async function recordSplitEntry({ athleteId, date, type, name, assignmentId, segments }) {
  const { data, error } = await supabase.rpc('record_split_recorder_entry', {
    p_athlete_id: athleteId,
    p_date: date,
    p_type: type,
    p_name: name,
    p_assignment_id: assignmentId || null,
    p_segments: segments.map((s) => ({
      label: s.label || null,
      distance_value: s.distanceValue,
      distance_unit: s.distanceUnit,
      rep_times: s.repTimes,
    })),
  })
  if (error) throw error
  return data
}
