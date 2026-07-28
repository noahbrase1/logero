import { supabase } from './supabaseClient'

// Full goal history for one athlete, across all sports — fetched once per
// page view; "the goal in effect for a given week" is then picked out of
// this array client-side (see src/utils/weeklyGoals.js), since there's no
// existing SQL "as of" query convention in this app's schema to reuse.
export async function fetchWeeklyGoals(athleteId) {
  const { data, error } = await supabase
    .from('weekly_goals')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('effective_date')
  if (error) throw error
  return data
}

// Sets an athlete's weekly goal for one sport, effective on `effectiveDate`.
// Upserts on (athlete_id, sport, effective_date) rather than inserting
// unconditionally, so re-saving the same day (e.g. a coach correcting a
// typo) updates that day's row instead of erroring on the unique
// constraint or littering history with same-day duplicates — history for
// any *other* effective_date is never touched.
export async function setWeeklyGoal(athleteId, sport, { goalValue, goalUnit, effectiveDate }) {
  const { data, error } = await supabase
    .from('weekly_goals')
    .upsert(
      { athlete_id: athleteId, sport, goal_value: goalValue, goal_unit: goalUnit, effective_date: effectiveDate },
      { onConflict: 'athlete_id,sport,effective_date' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}
