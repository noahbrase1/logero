import { useEffect, useState } from 'react'
import { fetchAssignmentsForAthlete } from '../lib/assignments'
import { fetchWorkouts } from '../lib/workouts'
import {
  MILEAGE_SPORTS,
  weeklyAssignedOtherMinutes,
  weeklyAssignedTotalsBySport,
  weeklyLoggedOtherMinutes,
  weeklyLoggedTotalsBySport,
} from '../utils/weeklyMileage'
import { addDays, formatWeekRangeLabel, startOfWeek, toDateStr } from '../utils/week'
import SportProgressMeter from './SportProgressMeter'

const ALL_SPORTS = [...MILEAGE_SPORTS, 'other']

// "Weekly Mileage": four per-sport progress meters (running/swim/bike by
// distance, Other Aerobic by minutes) — logged total this week vs. whatever
// the coach assigned that athlete that week (summed across every assignment
// in the range, however it was created: the grid, the flat list, or the
// calendar's per-athlete assignment modal). There's no separately coach-set
// goal number — the target simply carries over from assigned mileage/
// duration, so it updates the moment an assignment changes.
export default function WeeklyMileageSection({ athleteId }) {
  const [weekMonday, setWeekMonday] = useState(() => startOfWeek(new Date()))
  const [workouts, setWorkouts] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const currentWeekMonday = startOfWeek(new Date())
  const isCurrentWeek = toDateStr(weekMonday) === toDateStr(currentWeekMonday)

  useEffect(() => {
    if (!athleteId) return
    setLoading(true)
    setError('')
    const startDate = toDateStr(weekMonday)
    const endDate = toDateStr(addDays(weekMonday, 6))
    Promise.all([
      fetchWorkouts({ userId: athleteId, startDate, endDate }),
      fetchAssignmentsForAthlete(athleteId, { startDate, endDate }),
    ])
      .then(([workoutData, assignmentData]) => {
        setWorkouts(workoutData)
        setAssignments(assignmentData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [athleteId, weekMonday])

  const totals = { ...weeklyLoggedTotalsBySport(workouts), other: weeklyLoggedOtherMinutes(workouts) }
  const goals = { ...weeklyAssignedTotalsBySport(assignments), other: weeklyAssignedOtherMinutes(assignments) }

  return (
    <div className="weekly-mileage-section">
      <div className="weekly-mileage-header">
        <h2 className="events-section-heading">Weekly mileage</h2>
        <div className="week-nav">
          <button type="button" className="secondary" onClick={() => setWeekMonday((d) => addDays(d, -7))}>
            ← Prev
          </button>
          <span className="week-nav-label">{formatWeekRangeLabel(weekMonday)}</span>
          <button
            type="button"
            className="secondary"
            disabled={isCurrentWeek}
            onClick={() => setWeekMonday((d) => addDays(d, 7))}
          >
            Next →
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="progress-meter-row">
        {loading
          ? ALL_SPORTS.map((sport) => (
              <div key={sport} className="progress-meter-card skeleton-card" style={{ height: 140 }} />
            ))
          : ALL_SPORTS.map((sport) => (
              <SportProgressMeter
                key={sport}
                sport={sport}
                current={totals[sport]}
                goal={goals[sport] > 0 ? goals[sport] : null}
              />
            ))}
      </div>
    </div>
  )
}
