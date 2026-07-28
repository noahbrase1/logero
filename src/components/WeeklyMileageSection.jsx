import { useEffect, useState } from 'react'
import { fetchWeeklyGoals, setWeeklyGoal } from '../lib/weeklyGoals'
import { fetchWorkouts } from '../lib/workouts'
import { goalValueToMiles } from '../utils/format'
import { goalInEffect, weeklyTotalsBySport } from '../utils/weeklyGoals'
import { addDays, formatWeekRangeLabel, startOfWeek, toDateStr } from '../utils/week'
import SportProgressMeter from './SportProgressMeter'

// Unit options offered per sport in the goal-setting form — mirrors each
// sport's own distance_unit check constraint (running_segments_schema.sql,
// swimming_schema.sql, cycling_schema.sql) rather than one generic list.
const UNIT_OPTIONS_BY_SPORT = {
  running: ['miles', 'km', 'meters'],
  swim: ['yards', 'meters', 'miles'],
  bike: ['miles', 'km'],
}

const SPORTS = ['running', 'swim', 'bike']

function emptyGoalForm() {
  return {
    running: { value: '', unit: 'miles' },
    swim: { value: '', unit: 'yards' },
    bike: { value: '', unit: 'miles' },
  }
}

// "Weekly Mileage": three per-sport progress meters (logged distance this
// week vs. a coach-set goal), with Mon-Sun week navigation. Read-only for
// everyone; when `isCoach` is true an inline form to set/update the
// athlete's goals is also shown (the athlete never edits their own goal).
export default function WeeklyMileageSection({ athleteId, isCoach }) {
  const [goals, setGoals] = useState([])
  const [weekMonday, setWeekMonday] = useState(() => startOfWeek(new Date()))
  const [workouts, setWorkouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [goalForm, setGoalForm] = useState(emptyGoalForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')

  const currentWeekMonday = startOfWeek(new Date())
  const isCurrentWeek = toDateStr(weekMonday) === toDateStr(currentWeekMonday)

  useEffect(() => {
    if (!athleteId) return
    fetchWeeklyGoals(athleteId)
      .then(setGoals)
      .catch((err) => setError(err.message))
  }, [athleteId])

  useEffect(() => {
    if (!athleteId) return
    setLoading(true)
    setError('')
    fetchWorkouts({ userId: athleteId, startDate: toDateStr(weekMonday), endDate: toDateStr(addDays(weekMonday, 6)) })
      .then(setWorkouts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [athleteId, weekMonday])

  // The goal-editing form always reflects/edits the goal going forward from
  // today, independent of whichever past week is currently being browsed
  // via the arrows below.
  useEffect(() => {
    if (!isCoach) return
    const todayStr = toDateStr(new Date())
    const next = emptyGoalForm()
    for (const sport of SPORTS) {
      const goal = goalInEffect(goals, sport, todayStr)
      if (goal && goal.goal_value > 0) {
        next[sport] = { value: String(goal.goal_value), unit: goal.goal_unit }
      }
    }
    setGoalForm(next)
  }, [goals, isCoach])

  const totals = weeklyTotalsBySport(workouts)
  const weekSundayStr = toDateStr(addDays(weekMonday, 6))

  function goalMilesFor(sport) {
    const goal = goalInEffect(goals, sport, weekSundayStr)
    if (!goal || goal.goal_value <= 0) return null
    return goalValueToMiles(goal.goal_value, goal.goal_unit)
  }

  async function handleSaveGoals(e) {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    setSaveSuccess('')
    try {
      const effectiveDate = toDateStr(new Date())
      const updated = []
      for (const sport of SPORTS) {
        const { value, unit } = goalForm[sport]
        const goalValue = Number(value) || 0
        const saved = await setWeeklyGoal(athleteId, sport, { goalValue, goalUnit: unit, effectiveDate })
        updated.push(saved)
      }
      setGoals((prev) => {
        const withoutToday = prev.filter(
          (g) => !(g.effective_date === effectiveDate && SPORTS.includes(g.sport))
        )
        return [...withoutToday, ...updated]
      })
      setSaveSuccess('Goals updated.')
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

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
          ? SPORTS.map((sport) => (
              <div key={sport} className="progress-meter-card skeleton-card" style={{ height: 140 }} />
            ))
          : SPORTS.map((sport) => (
              <SportProgressMeter
                key={sport}
                sport={sport}
                currentMiles={totals[sport]}
                goalMiles={goalMilesFor(sport)}
              />
            ))}
      </div>

      {isCoach && (
        <form className="theme-settings weekly-goal-form" onSubmit={handleSaveGoals}>
          <h3 className="events-section-heading">Set weekly goals</h3>
          <p className="page-subtitle">Leave a sport at 0 if you aren't tracking a weekly goal for it.</p>
          <div className="weekly-goal-form-row">
            {SPORTS.map((sport) => (
              <label key={sport} className="weekly-goal-input">
                {sport === 'running' ? 'Running' : sport === 'swim' ? 'Swimming' : 'Cycling'}
                <div className="form-row">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={goalForm[sport].value}
                    onChange={(e) =>
                      setGoalForm((prev) => ({ ...prev, [sport]: { ...prev[sport], value: e.target.value } }))
                    }
                  />
                  <select
                    value={goalForm[sport].unit}
                    onChange={(e) =>
                      setGoalForm((prev) => ({ ...prev, [sport]: { ...prev[sport], unit: e.target.value } }))
                    }
                  >
                    {UNIT_OPTIONS_BY_SPORT[sport].map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            ))}
          </div>
          {saveError && <p className="form-error">{saveError}</p>}
          {saveSuccess && <p className="form-info">{saveSuccess}</p>}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save goals'}
          </button>
        </form>
      )}
    </div>
  )
}
