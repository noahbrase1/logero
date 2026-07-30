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

function emptySegment() {
  return { key: crypto.randomUUID(), label: '', distanceValue: '', distanceUnit: 'meters', reps: 4 }
}

function segmentDisplayName(seg) {
  return (
    seg.label ||
    `${Number(seg.reps) || 1}x${formatDistanceValue(Number(seg.distanceValue) || 0, seg.distanceUnit)}${unitAbbrev(seg.distanceUnit)}`
  )
}

// Defaults the setup (type/name/segments) from the day's most common
// assignment — "most common" meaning the largest group of athletes
// assigned the exact same workout, via the same grouping the assignment
// grid's "Export day" flow already uses. Every one of that assignment's
// segments is carried over (a 2mi warm-up + 4x400m + 4x200m assignment
// defaults to all three, not just one), preserving their order. Returns
// null when nothing on the day is a segment-based type (running/swim/bike/
// other) with at least one segment — e.g. an all-lifting day, or no
// assignments at all — leaving the caller to fall back to a blank default.
function computeSetupDefaults(assignments) {
  const segmentBased = (assignments || []).filter((a) => SPORT_TYPES.includes(a.type))
  if (segmentBased.length === 0) return null
  const groups = groupAssignmentsByWorkout(segmentBased)
  const largest = groups.reduce((best, g) => (g.assignments.length > best.assignments.length ? g : best), groups[0])
  const rep = largest.assignments[0]
  const rawSegments = rep[ASSIGNED_SEGMENTS_FIELD_BY_TYPE[rep.type]] || []
  if (rawSegments.length === 0) return null

  const segments = rawSegments.map((seg) => ({
    key: crypto.randomUUID(),
    label: seg.label || '',
    distanceValue: String(seg.distance_value),
    distanceUnit: seg.distance_unit,
    reps: seg.reps || 1,
  }))
  const name = segments.map(segmentDisplayName).join(', ')
  return { type: rep.type, name, segments }
}

// This athlete's own assigned target time for one (segment, rep) column,
// paired to the setup's segment by *position* — the same "paired by index"
// convention WorkoutCard's own actual/prescribed segments already use —
// not by matching distance, so it still works even if the coach adjusted a
// segment's distance from what was originally assigned. null when this
// athlete has no assignment of a matching type, that assignment has no
// segment at this position, or that rep has no recorded target.
function prescribedSecondsForColumn(assignment, type, segIndex, repIndex) {
  if (!assignment || assignment.type !== type) return null
  const segs = assignment[ASSIGNED_SEGMENTS_FIELD_BY_TYPE[type]] || []
  const seg = segs[segIndex]
  if (!seg) return null
  const repRows = seg[ASSIGNED_REPS_FIELD_BY_TYPE[type]] || []
  if (repRows.length > 0) {
    const row = repRows[repIndex]
    if (!row) return null
    const s = hmsToSeconds({ hours: row.target_time_hours, minutes: row.target_time_minutes, seconds: row.target_time_seconds })
    return s > 0 ? s : null
  }
  // A target segment saved before per-rep rows existed has none yet — its
  // single legacy target applies to every rep.
  const single = hmsToSeconds({
    hours: seg.target_time_hours,
    minutes: seg.target_time_minutes,
    seconds: seg.target_time_seconds,
  })
  return single > 0 ? single : null
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

// Reads a previously-saved split-recorder workout's segments back into a
// flat array matching the current setup's column order (segment-by-
// segment, then rep-by-rep within each). A saved segment only ever holds
// however many reps were actually filled in last time (gaps are dropped at
// save time, not preserved), so this places them in the first N columns of
// the matching setup segment — there's no way to recover which original
// column a compacted rep came from, and for a live-recording tool that
// distinction isn't meaningful anyway.
function buildInitialEntries(athletes, workouts, type, segments, assignmentByAthleteId) {
  const initial = {}
  for (const athlete of athletes) {
    const athleteAssignment = assignmentByAthleteId.get(athlete.id)
    const assignmentId = athleteAssignment && athleteAssignment.type === type ? athleteAssignment.id : null
    const existing = findExistingEntry(workouts, athlete.id, type, assignmentId)
    if (!existing) continue

    const savedSegments = existing[LOGGED_SEGMENTS_FIELD_BY_TYPE[existing.type]] || []
    const repsField = LOGGED_REPS_FIELD_BY_TYPE[existing.type]
    const flatValues = []
    segments.forEach((setupSeg, segIndex) => {
      const savedSeg = savedSegments[segIndex]
      const savedReps = savedSeg ? savedSeg[repsField] || [] : []
      const columnCount = Math.max(1, Number(setupSeg.reps) || 1)
      for (let i = 0; i < columnCount; i++) {
        const r = savedReps[i]
        flatValues.push(r ? { hours: r.time_hours, minutes: r.time_minutes, seconds: r.time_seconds } : undefined)
      }
    })
    initial[athlete.id] = flatValues
  }
  return initial
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
  const [segments, setSegments] = useState([emptySegment()])

  // athleteId -> flat array of {hours,minutes,seconds}, one per column of
  // columnDefs below (segment-by-segment, then rep-by-rep within each).
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
        const defaults = computeSetupDefaults(assignments) || { type: 'running', name: '', segments: [emptySegment()] }
        setType(defaults.type)
        setName(defaults.name)
        setSegments(defaults.segments)

        const assignmentMap = new Map(assignments.map((a) => [a.athlete_id, a]))
        setEntries(buildInitialEntries(athletes, workouts, defaults.type, defaults.segments, assignmentMap))
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingDay(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadDay, [date])

  // Keeps every segment's unit valid when the coach switches sport type
  // after load — a default carried over from e.g. a swim assignment
  // ("yards") isn't one of bike's own unit options.
  useEffect(() => {
    setSegments((prev) =>
      prev.map((s) => (UNIT_OPTIONS_BY_TYPE[type].includes(s.distanceUnit) ? s : { ...s, distanceUnit: UNIT_OPTIONS_BY_TYPE[type][0] }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  // Adding/removing a segment, or changing one's rep count, shifts every
  // later column's flattened position — clearing `entries` avoids already-
  // typed times silently landing in the wrong column after such a
  // structural edit (a plain label/distance/unit edit doesn't move any
  // column, so those don't need to touch it).
  function updateSegment(index, field, value) {
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
    if (field === 'reps') setEntries({})
  }

  function addSegment() {
    setSegments((prev) => [...prev, { ...emptySegment(), distanceUnit: UNIT_OPTIONS_BY_TYPE[type][0] }])
    setEntries({})
  }

  function removeSegment(index) {
    setSegments((prev) => prev.filter((_, i) => i !== index))
    setEntries({})
  }

  function updateCell(flatIndex, athleteId, value) {
    setEntries((prev) => {
      const next = (prev[athleteId] || []).slice()
      next[flatIndex] = value
      return { ...prev, [athleteId]: next }
    })
  }

  // Flattens segments into one column per rep, in order — this is the grid's
  // actual column list, and the index into it is what `entries` is keyed on.
  const columnDefs = useMemo(() => {
    const defs = []
    segments.forEach((seg, segIndex) => {
      const reps = Math.max(1, Number(seg.reps) || 1)
      for (let repIndex = 0; repIndex < reps; repIndex++) {
        defs.push({ segIndex, repIndex, seg, isSegmentStart: repIndex === 0 && segIndex > 0 })
      }
    })
    return defs
  }, [segments])

  // TimeTextInput only ever reads its `value` prop once, on mount (see that
  // component) — so clearing `entries` after a structural segment edit
  // isn't enough on its own to blank out an already-typed cell that keeps
  // the same column position. Keying the grid on the column layout (in
  // addition to `date`) forces a full remount whenever the layout shifts,
  // the same trick already used for switching days.
  const columnLayoutKey = segments.map((s) => Math.max(1, Number(s.reps) || 1)).join('-')

  const setupValid =
    name.trim() !== '' &&
    segments.length > 0 &&
    segments.every((s) => Number(s.distanceValue) > 0 && Number(s.reps) >= 1)

  // Builds this athlete's segments payload for saving: only the reps they
  // actually have a time for (in order, gaps simply dropped), and only
  // segments with at least one such rep — a segment nobody filled in for
  // this athlete is left out entirely rather than sent as an empty one.
  function buildAthletePayload(athleteId) {
    const values = entries[athleteId] || []
    const bySegment = segments.map(() => [])
    columnDefs.forEach((def, flatIndex) => {
      const v = values[flatIndex]
      if (v && hmsToSeconds(v) > 0) bySegment[def.segIndex].push(v)
    })
    return segments
      .map((seg, i) => ({ label: seg.label, distanceValue: Number(seg.distanceValue), distanceUnit: seg.distanceUnit, repTimes: bySegment[i] }))
      .filter((s) => s.repTimes.length > 0)
  }

  async function handleSave() {
    setSaveError('')
    if (!setupValid) {
      setSaveError('Enter a workout name and a positive distance for every segment before saving.')
      return
    }

    const targets = athletes
      .map((athlete) => ({ athlete, segments: buildAthletePayload(athlete.id) }))
      .filter((t) => t.segments.length > 0)

    if (targets.length === 0) {
      showToast('Nothing to save yet — enter at least one split time', 'error')
      return
    }

    setSaving(true)
    const errors = await mapWithConcurrency(targets, 5, async ({ athlete, segments: athleteSegments }) => {
      const athleteAssignment = assignmentByAthleteId.get(athlete.id)
      const assignmentId = athleteAssignment && athleteAssignment.type === type ? athleteAssignment.id : null
      await recordSplitEntry({
        athleteId: athlete.id,
        date,
        type,
        name: name.trim(),
        assignmentId,
        segments: athleteSegments,
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
              // date but the previous day's still-loaded entries/segments.
              setLoadingDay(true)
              setDate(e.target.value)
            }}
          />
        </label>

        <label>
          Workout name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tempo run" />
        </label>
      </div>

      <div className="type-toggle">
        {SPORT_TYPES.map((t) => (
          <button key={t} type="button" className={type === t ? 'active' : ''} onClick={() => setType(t)}>
            {workoutTypeLabel(t)}
          </button>
        ))}
      </div>

      <fieldset className="splits-fieldset split-recorder-segments">
        <legend>Segments</legend>
        {segments.map((seg, i) => (
          <div className="form-row exercise-row" key={seg.key}>
            <label>
              Label (optional)
              <input
                type="text"
                placeholder="e.g. Warm-up"
                value={seg.label}
                onChange={(e) => updateSegment(i, 'label', e.target.value)}
              />
            </label>
            <label>
              Distance
              <input
                type="number"
                min="0"
                step="any"
                value={seg.distanceValue}
                onChange={(e) => updateSegment(i, 'distanceValue', e.target.value)}
              />
            </label>
            <label>
              Unit
              <select value={seg.distanceUnit} onChange={(e) => updateSegment(i, 'distanceUnit', e.target.value)}>
                {UNIT_OPTIONS_BY_TYPE[type].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reps
              <input type="number" min="1" value={seg.reps} onChange={(e) => updateSegment(i, 'reps', e.target.value)} />
            </label>
            {segments.length > 1 && (
              <button type="button" className="remove-row" onClick={() => removeSegment(i)} aria-label="Remove segment">
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" className="add-row" onClick={addSegment}>
          + Add segment
        </button>
      </fieldset>

      {loadError && <p className="form-error">{loadError}</p>}
      {saveError && <p className="form-error">{saveError}</p>}

      {loadingDay ? (
        <div className="loading-state">
          <span className="spinner" /> Loading…
        </div>
      ) : athletes.length === 0 ? (
        <p className="empty-state">No approved athletes yet.</p>
      ) : !setupValid ? (
        <p className="empty-state">Enter a workout name and a positive distance for every segment above to start recording.</p>
      ) : (
        <div className="assignment-grid-wrap" key={`${date}-${columnLayoutKey}`}>
          <table className="assignment-grid split-recorder-grid">
            <thead>
              <tr>
                <th className="grid-corner-cell" />
                {columnDefs.map((def, i) => (
                  <th key={i} className={`grid-day-header${def.isSegmentStart ? ' split-recorder-segment-start' : ''}`}>
                    {formatDistanceValue(Number(def.seg.distanceValue) || 0, def.seg.distanceUnit)}
                    {unitAbbrev(def.seg.distanceUnit)} ({def.repIndex + 1})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {athletes.map((athlete) => {
                const athleteAssignment = assignmentByAthleteId.get(athlete.id)
                return (
                  <tr key={athlete.id}>
                    <th scope="row" className="grid-athlete-cell">
                      {athlete.name || 'Unnamed athlete'}
                    </th>
                    {columnDefs.map((def, i) => {
                      const prescribed = prescribedSecondsForColumn(athleteAssignment, type, def.segIndex, def.repIndex)
                      return (
                        <td key={i} className={`grid-cell split-recorder-cell${def.isSegmentStart ? ' split-recorder-segment-start' : ''}`}>
                          <TimeTextInput
                            value={entries[athlete.id]?.[i] || { hours: 0, minutes: 0, seconds: 0 }}
                            onChange={(v) => updateCell(i, athlete.id, v)}
                            ariaLabel={`${athlete.name || 'Athlete'} ${segmentDisplayName(def.seg)} rep ${def.repIndex + 1}`}
                            placeholder={prescribed ? secondsToClock(prescribed) : 'e.g. 6:45'}
                          />
                        </td>
                      )
                    })}
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
