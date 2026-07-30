import { supabase } from './supabaseClient'

// Coach-only: create-or-update one athlete's recorded-splits log for a day,
// via the record_split_recorder_entry SECURITY DEFINER RPC (see
// supabase/split_recorder_schema.sql for why this can't be a plain client
// insert — a coach has no RLS write path into another athlete's `workouts`
// row for any type but 'note'). `repTimes`: [{hours,minutes,seconds}, ...],
// already trimmed to just the columns the coach actually filled in.
export async function recordSplitEntry({
  athleteId,
  date,
  type,
  name,
  distanceValue,
  distanceUnit,
  assignmentId,
  repTimes,
}) {
  const { data, error } = await supabase.rpc('record_split_recorder_entry', {
    p_athlete_id: athleteId,
    p_date: date,
    p_type: type,
    p_name: name,
    p_distance_value: distanceValue,
    p_distance_unit: distanceUnit,
    p_assignment_id: assignmentId || null,
    p_rep_times: repTimes,
  })
  if (error) throw error
  return data
}
