import { sumAssignedDistanceMiles, sumLoggedDistanceMiles } from './format'

export const MILEAGE_SPORTS = ['running', 'swim', 'bike']

function emptyTotals() {
  return { running: 0, swim: 0, bike: 0 }
}

function round(totals) {
  for (const sport of MILEAGE_SPORTS) {
    totals[sport] = Math.round(totals[sport] * 100) / 100
  }
  return totals
}

// Sums a week's logged workouts into one miles total per sport (running/
// swim/bike only — lifting/note have no distance concept). Pure "did they
// actually cover the distance" total.
export function weeklyLoggedTotalsBySport(workouts) {
  const totals = emptyTotals()
  for (const workout of workouts || []) {
    if (workout.type in totals) {
      totals[workout.type] += sumLoggedDistanceMiles(workout)
    }
  }
  return round(totals)
}

// Sums a week's coach-assigned target distance into one miles total per
// sport — this *is* the "goal" the progress meters fill toward, carried
// over directly from whatever the coach assigned that week (grid, list, or
// calendar), rather than a separately coach-set number.
export function weeklyAssignedTotalsBySport(assignments) {
  const totals = emptyTotals()
  for (const assignment of assignments || []) {
    if (assignment.type in totals) {
      totals[assignment.type] += sumAssignedDistanceMiles(assignment)
    }
  }
  return round(totals)
}
