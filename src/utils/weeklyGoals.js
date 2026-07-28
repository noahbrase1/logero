import { sumLoggedDistanceMiles } from './format'

export const MILEAGE_SPORTS = ['running', 'swim', 'bike']

// The goal row in effect for a given week, per sport: the most recent goal
// whose effective_date is on or before that week's *Sunday* (its last day),
// not its Monday. The goal form only ever saves with effectiveDate = today,
// so a goal set mid-week (e.g. Tuesday) still applies to the whole week
// it's set in — comparing against Monday would wrongly exclude it until the
// following week. For an already-concluded past week, its Sunday is in the
// past too, so a goal set *after* that week ended (effective_date > that
// Sunday) still correctly falls outside it — a goal change never
// retroactively applies to a week that had already finished. Returns null
// if no goal has ever been set for that sport (or the closest one on
// record actually starts later than the viewed week).
export function goalInEffect(goals, sport, weekSundayStr) {
  return (goals || [])
    .filter((g) => g.sport === sport && g.effective_date <= weekSundayStr)
    .reduce((latest, g) => (!latest || g.effective_date > latest.effective_date ? g : latest), null)
}

// Sums a week's logged workouts into one miles total per sport (running/
// swim/bike only — lifting/note have no distance concept). Pure "did they
// actually cover the distance" total, unrelated to any assignment/target.
export function weeklyTotalsBySport(workouts) {
  const totals = { running: 0, swim: 0, bike: 0 }
  for (const workout of workouts || []) {
    if (workout.type in totals) {
      totals[workout.type] += sumLoggedDistanceMiles(workout)
    }
  }
  for (const sport of MILEAGE_SPORTS) {
    totals[sport] = Math.round(totals[sport] * 100) / 100
  }
  return totals
}
