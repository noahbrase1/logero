import { useEffect, useMemo, useState } from 'react'
import { fetchAssignmentsForCoach } from '../lib/assignments'
import { fetchTeamWorkoutsByDate } from '../lib/workouts'
import { recordSplitEntry } from '../lib/splitRecorder'
import { groupAssignmentsByWorkout } from '../utils/assignmentGroups'
import { mapWithConcurrency } from '../utils/concurrency'
import { toDateStr } from '../utils/week'
import {
  ASSIGNED_REPS_FIELD_BY_TYPE,
  ASSIGNED_SEGMENTS_FIELD_BY_TYPE,
  LOGGED_REPS_FIELD_BY_TYPE,
  LOGGED_SEGMENTS_FIELD_BY_TYPE,
  formatDistanceValue,
  hmsToSeconds,
  secondsToClock,
  unitAbbrev,
  workoutTypeLabel,
} from '../utils/format'
import TimeTextInput from './TimeTextInput'
import { useToast } from '../context/ToastContext'

const SPORT_TYPES = ['running', 'swim', 'bike', 'other']

const UNIT_OPTIONS_BY_TYPE = {
  running: ['meters', 'km', 'miles'],
  swim: ['yards', 'meters', 'miles'],
  bike: ['miles', 'km'],
  other: ['miles', 'meters', 'km', 'feet', 'yards'],
}

function emptyRepTime() {
  return { hours: 0, minutes: 0, seconds: 0 }
}

// The segment a coach would consider "the workout" for defaulting purposes —
// the one with the most reps (an interval segment like "4x800m", as
// opposed to a 1-rep warm-up/cool-down segment sharing the same assignment).
function primarySegment(segments) {
  if (!segments || segments.length === 0) return null
  return segments.reduce((best, s) => ((s.reps || 1) > (best.reps || 1) ? s : best), segments[0])
}

// Defaults the setup fields (type/name/columns/distance) from the day's
// most common assignment — "most common" meaning the largest group of
// athletes assigned the exact same workout, via the same grouping the
// assignment grid's "Export day" flow already uses. Returns null when
// nothing on the day is a segment-based type (running/swim/bike/other) with
// at least one segment — e.g. an all-lifting day, or no assignments at all —
// leaving the caller to fall back to blank/generic defaults.
function computeSetupDefaults(assignments) {
  const segmentBased = (assignments || []).filter((a) => SPORT_TYPES.includes(a.type))
  if (segmentBased.length === 0) return null
  const groups = groupAssignmentsByWorkout(segmentBased)
  const largest = groups.reduce((best, g) => (g.assignments.length > best.assignments.length ? g : best), groups[0])
  const rep = largest.assignments[0]
  const segment = primarySegment(rep[ASSIGNED_SEGMENTS_FIELD_BY_TYPE[rep.type]])
  if (!segment) return null
  return {
    type: rep.type,
    name:
      segment.label ||
      `${segment.reps || 1}x${formatDistanceValue(segment.distance_value, segment.distance_unit)}${unitAbbrev(segment.distance_unit)}`,
    columns: segment.reps || 1,
    distanceValue: String(segment.distance_value),
    distanceUnit: segment.distance_unit,
  }
}

// This athlete's own assigned target times for `type`, one entry per rep of
// its primary (highest-reps) segment — null where a specific rep has no
// recorded target. Empty when this athlete has no assignment of a matching
// type that day, or that assignment has no segments.
function prescribedSecondsForAthlete(assignment, type) {
  if (!assignment || assignment.type !== type) return []
  const segment = primarySegment(assignment[ASSIGNED_SEGMENTS_FIELD_BY_TYPE[type]])
  if (!segment) return []
  const repRows = segment[ASSIGNED_REPS_FIELD_BY_TYPE[type]] || []
  if (repRows.length > 0) {
    return repRows.map((r) => {
      const s = hmsToSeconds({ hours: r.target_time_hours, minutes: r.target_time_minutes, seconds: r.target_time_seconds })
      return s > 0 ? s : null
    })
  }
  const single = hmsToSeconds({
    hours: segment.target_time_hours,
    minutes: segment.target_time_minutes,
    seconds: segment.target_time_seconds,
  })
  return single > 0 ? Array.from({ length: segment.reps || 1 }, () => single) : []
}

// Reads back a previously-recorded split entry's rep times, so reopening
// the recorder for a day already partially filled in shows what was saved.
function repTimesFromWorkout(workout) {
  const segments = workout[LOGGED_SEGMENTS_FIELD_BY_TYPE[workout.type]] || []
  const segment = segments[0]
  if (!segment) return []
  const repRows = segment[LOGGED_REPS_FIELD_BY_TYPE[workout.type]] || []
  return repRows.map((r) => ({ hours: r.time_hours, minutes: r.time_minutes, seconds: r.time_seconds }))
}

// Only ever matches a workout this same tool previously created (see
// split_recorder_schema.sql's `source` column) — never an athlete's own
// unrelated log, even one that happens to share a name.
function findExistingEntry(workouts, athleteId, type, assignmentId) {
  const candidates = workouts.filter((w) => w.user_id === athleteId && w.type === type && w.source === 'split_recorder')
  if (assignmentId) {
    const linked = candidates.find((w) => w.assignment_id === assignmentId)
    if (linked) return linked
  }
  return candidates.find((w) => !w.assignment_id) || null
}

// Coach tool: record live workout splits for many athletes at once,
// saving straight into each athlete's log — see CLAUDE.md's "Split
// Recorder" section. `athletes` is the same alphabetically-sorted roster
// CoachAssignmentsPage already passes to AssignmentGrid.
export default function SplitRecorder({ athletes }) {
  const { showToast } = useToast()
  const [date, setDate] = useState(() => toDateStr(new Date()))
  const [loadingDay, setLoadingDay] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [dayAssignments, setDayAssignments] = useState([])

  const [type, setType] = useState('running')
  const [name, setName] = useState('')
  const [columns, setColumns] = useState(4)
  const [distanceValue, setDistanceValue] = useState('')
  const [distanceUnit, setDistanceUnit] = useState('meters')

  // athleteId -> [{hours,minutes,seconds}, ...], indexed by column.
  const [entries, setEntries] = useState({})

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const assignmentByAthleteId = useMemo(() => {
    const map = new Map()
    for (const a of dayAssignments) map.set(a.athlete_id, a)
    return map
  }, [dayAssignments])

  function loadDay() {
    setLoadingDay(true)
    setLoadError('')
    Promise.all([fetchAssignmentsForCoach({ startDate: date, endDate: date }), fetchTeamWorkoutsByDate(date)])
      .then(([assignments, workouts]) => {
        setDayAssignments(assignments)
        const defaults = computeSetupDefaults(assignments) || {
          type: 'running',
          name: '',
          columns: 4,
          distanceValue: '',
          distanceUnit: 'meters',
        }
        setType(defaults.type)
        setName(defaults.name)
        setColumns(defaults.columns)
        setDistanceValue(defaults.distanceValue)
        setDistanceUnit(defaults.distanceUnit)

        const assignmentMap = new Map(assignments.map((a) => [a.athlete_id, a]))
        const initialEntries = {}
        for (const athlete of athletes) {
          const athleteAssignment = assignmentMap.get(athlete.id)
          const assignmentId = athleteAssignment && athleteAssignment.type === defaults.type ? athleteAssignment.id : null
          const existing = findExistingEntry(workouts, athlete.id, defaults.type, assignmentId)
          if (existing) initialEntries[athlete.id] = repTimesFromWorkout(existing)
        }
        setEntries(initialEntries)
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingDay(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadDay, [date])

  // Keeps the unit dropdown valid when the coach switches sport type after
  // load — a default carried over from e.g. a swim assignment ("yards")
  // isn't one of bike's own unit options.
  useEffect(() => {
    if (!UNIT_OPTIONS_BY_TYPE[type].includes(distanceUnit)) {
      setDistanceUnit(UNIT_OPTIONS_BY_TYPE[type][0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  function updateCell(athleteId, columnIndex, value) {
    setEntries((prev) => {
      const next = (prev[athleteId] || []).slice()
      next[columnIndex] = value
      return { ...prev, [athleteId]: next }
    })
  }

  const columnIndexes = useMemo(() => Array.from({ length: Math.max(1, Number(columns) || 1) }, (_, i) => i), [columns])

  const setupValid = name.trim() !== '' && Number(distanceValue) > 0

  async function handleSave() {
    setSaveError('')
    if (!setupValid) {
      setSaveError('Enter a workout name and a positive distance before saving.')
      return
    }

    const targets = athletes
      .map((athlete) => {
        const repTimes = (entries[athlete.id] || []).slice(0, columnIndexes.length).filter((t) => t && hmsToSeconds(t) > 0)
        return { athlete, repTimes }
      })
      .filter((t) => t.repTimes.length > 0)

    if (targets.length === 0) {
      showToast('Nothing to save yet — enter at least one split time', 'error')
      return
    }

    setSaving(true)
    const errors = await mapWithConcurrency(targets, 5, async ({ athlete, repTimes }) => {
      const athleteAssignment = assignmentByAthleteId.get(athlete.id)
      const assignmentId = athleteAssignment && athleteAssignment.type === type ? athleteAssignment.id : null
      await recordSplitEntry({
        athleteId: athlete.id,
        date,
        type,
        name: name.trim(),
        distanceValue: Number(distanceValue),
        distanceUnit,
        assignmentId,
        repTimes,
      })
    })
    setSaving(false)

    if (errors.length > 0) {
      setSaveError(`${errors.length} of ${targets.length} athletes failed to save: ${errors[0].message}`)
    } else {
      showToast(`Saved splits for ${targets.length} athlete${targets.length > 1 ? 's' : ''}`)
    }
    loadDay()
  }

  return (
    <div className="split-recorder">
      <div className="split-recorder-setup">
        <label>
          Day
          <input
            type="date"
            value={date}
            onChange={(e) => {
              // Set together so the loading state covers the very next
              // render — otherwise there's one committed frame with the new
              // date but the previous day's still-loaded entries/columns.
              setLoadingDay(true)
              setDate(e.target.value)
            }}
          />
        </label>

        <label>
          Workout name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 4x800m" />
        </label>

        <label>
          Splits
          <input type="number" min="1" value={columns} onChange={(e) => setColumns(e.target.value)} />
        </label>

        <label>
          Distance per split
          <input type="number" min="0" step="any" value={distanceValue} onChange={(e) => setDistanceValue(e.target.value)} />
        </label>

        <label>
          Unit
          <select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value)}>
            {UNIT_OPTIONS_BY_TYPE[type].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="type-toggle">
        {SPORT_TYPES.map((t) => (
          <button key={t} type="button" className={type === t ? 'active' : ''} onClick={() => setType(t)}>
            {workoutTypeLabel(t)}
          </button>
        ))}
      </div>

      {loadError && <p className="form-error">{loadError}</p>}
      {saveError && <p className="form-error">{saveError}</p>}

      {loadingDay ? (
        <div className="loading-state">
          <span className="spinner" /> Loading…
        </div>
      ) : athletes.length === 0 ? (
        <p className="empty-state">No approved athletes yet.</p>
      ) : !setupValid ? (
        <p className="empty-state">Enter a workout name and distance above to start recording.</p>
      ) : (
        <div className="assignment-grid-wrap" key={date}>
          <table className="assignment-grid split-recorder-grid">
            <thead>
              <tr>
                <th className="grid-corner-cell" />
                {columnIndexes.map((i) => (
                  <th key={i} className="grid-day-header">
                    Rep {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {athletes.map((athlete) => {
                const athleteAssignment = assignmentByAthleteId.get(athlete.id)
                const prescribed = prescribedSecondsForAthlete(athleteAssignment, type)
                return (
                  <tr key={athlete.id}>
                    <th scope="row" className="grid-athlete-cell">
                      {athlete.name || 'Unnamed athlete'}
                    </th>
                    {columnIndexes.map((i) => (
                      <td key={i} className="grid-cell split-recorder-cell">
                        <TimeTextInput
                          value={entries[athlete.id]?.[i] || emptyRepTime()}
                          onChange={(v) => updateCell(athlete.id, i, v)}
                          ariaLabel={`${athlete.name || 'Athlete'} rep ${i + 1}`}
                          placeholder={prescribed[i] ? secondsToClock(prescribed[i]) : 'e.g. 6:45'}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="split-recorder-actions">
        <button type="button" onClick={handleSave} disabled={saving || loadingDay}>
          {saving ? 'Saving…' : 'Save splits'}
        </button>
        <span className="split-recorder-hint">Save anytime — come back later to keep adding times before it's complete.</span>
      </div>
    </div>
  )
}
