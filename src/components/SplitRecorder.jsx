import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-react'
import { fetchAssignmentsForCoach } from '../lib/assignments'
import { fetchTeamWorkoutsByDate } from '../lib/workouts'
import { recordSplitEntry } from '../lib/splitRecorder'
import { mapWithConcurrency } from '../utils/concurrency'
import { downloadSplitRecorderPdf } from '../utils/splitRecorderPdf'
import { findNextOpenIndex, formatStopwatchClock, msToHms, useStopwatch } from '../utils/stopwatch'
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
} from '../utils/format'
import TimeTextInput from './TimeTextInput'
import { useToast } from '../context/ToastContext'

const SPORT_TYPES = ['running', 'swim', 'bike', 'other']

function segmentDisplayName(seg) {
  return (
    seg.label ||
    `${Number(seg.reps) || 1}x${formatDistanceValue(Number(seg.distanceValue) || 0, seg.distanceUnit)}${unitAbbrev(seg.distanceUnit)}`
  )
}

// Everything about what to show for one athlete — type, segments, an
// auto-generated name, and which assignment (if any) to link the saved log
// to — comes straight from their own assignment for the day. There is no
// manual setup UI anymore (an earlier version of this tool had a
// coach-editable name/type/fallback-segments panel, but with every
// athlete's columns already fully derived from their own data, that panel
// was pure redundant clutter — see CLAUDE.md's "Split Recorder" section).
// Returns null when this athlete simply has nothing to record against: no
// assignment that day, a lifting assignment (no splits concept), or an
// assignment with no segments.
function resolveAthlete(athlete, assignmentByAthleteId) {
  const assignment = assignmentByAthleteId.get(athlete.id)
  if (!assignment || !SPORT_TYPES.includes(assignment.type)) return null
  const rawSegments = assignment[ASSIGNED_SEGMENTS_FIELD_BY_TYPE[assignment.type]] || []
  if (rawSegments.length === 0) return null

  const segments = rawSegments.map((seg) => ({
    label: seg.label || '',
    distanceValue: String(seg.distance_value),
    distanceUnit: seg.distance_unit,
    reps: seg.reps || 1,
    targetSegment: seg,
  }))
  return {
    type: assignment.type,
    assignmentId: assignment.id,
    segments,
    name: segments.map(segmentDisplayName).join(', '),
  }
}

// Flattens one athlete's own segments into one column per rep, in order —
// different athletes can (and often will) have a different number of
// these, and a different meaning at the same position, since each is built
// from that specific athlete's own assignment.
function flattenSegments(segments) {
  const defs = []
  segments.forEach((seg, segIndex) => {
    const reps = Math.max(1, Number(seg.reps) || 1)
    for (let repIndex = 0; repIndex < reps; repIndex++) {
      defs.push({ segIndex, repIndex, seg, isSegmentStart: repIndex === 0 && segIndex > 0 })
    }
  })
  return defs
}

// This column's own assigned target time — trivially correct, since the
// column was built directly from this exact assigned segment in the first
// place (see resolveAthlete/flattenSegments), no matching involved.
function prescribedSecondsForDef(def, type) {
  const targetSeg = def.seg.targetSegment
  const repRows = targetSeg[ASSIGNED_REPS_FIELD_BY_TYPE[type]] || []
  if (repRows.length > 0) {
    const row = repRows[def.repIndex]
    if (!row) return null
    const s = hmsToSeconds({ hours: row.target_time_hours, minutes: row.target_time_minutes, seconds: row.target_time_seconds })
    return s > 0 ? s : null
  }
  // A target segment saved before per-rep rows existed has none yet — its
  // single legacy target applies to every rep.
  const single = hmsToSeconds({
    hours: targetSeg.target_time_hours,
    minutes: targetSeg.target_time_minutes,
    seconds: targetSeg.target_time_seconds,
  })
  return single > 0 ? single : null
}

// Matches a set of segments (an athlete's own current columns) to the
// segments of a previously-saved workout — by (distance_value,
// distance_unit) first, with label only as a tiebreaker among multiple
// same-distance candidates — so reopening the recorder still lines saved
// times up correctly even if the athlete's assignment changed distances
// between saves. Never positional: each candidate is claimed by at most
// one column, and a column with nothing matching returns null.
function matchSegmentsToSaved(currentSegments, savedSegments) {
  const remaining = (savedSegments || []).map((c, idx) => ({ c, idx }))
  return currentSegments.map((seg) => {
    const distance = Number(seg.distanceValue)
    const label = (seg.label || '').trim().toLowerCase()
    const sameDistance = remaining.filter(({ c }) => Number(c.distance_value) === distance && c.distance_unit === seg.distanceUnit)
    if (sameDistance.length === 0) return null
    const preferred = (label && sameDistance.find(({ c }) => (c.label || '').trim().toLowerCase() === label)) || sameDistance[0]
    remaining.splice(remaining.indexOf(preferred), 1)
    return preferred.c
  })
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
// flat array matching each athlete's own current column order. A saved
// segment only ever holds however many reps were actually filled in last
// time (gaps are dropped at save time, not preserved), so this places them
// in the first N columns of the matching segment.
function buildInitialEntries(athletes, workouts, assignmentByAthleteId) {
  const initial = {}
  for (const athlete of athletes) {
    const resolved = resolveAthlete(athlete, assignmentByAthleteId)
    if (!resolved) continue
    const existing = findExistingEntry(workouts, athlete.id, resolved.type, resolved.assignmentId)
    if (!existing) continue

    const savedSegments = existing[LOGGED_SEGMENTS_FIELD_BY_TYPE[existing.type]] || []
    const matchedSavedSegments = matchSegmentsToSaved(resolved.segments, savedSegments)
    const repsField = LOGGED_REPS_FIELD_BY_TYPE[existing.type]
    const flatValues = []
    resolved.segments.forEach((seg, segIndex) => {
      const savedSeg = matchedSavedSegments[segIndex]
      const savedReps = savedSeg ? savedSeg[repsField] || [] : []
      const columnCount = Math.max(1, Number(seg.reps) || 1)
      for (let i = 0; i < columnCount; i++) {
        const r = savedReps[i]
        flatValues.push(
          r ? { hours: r.time_hours, minutes: r.time_minutes, seconds: r.time_seconds, centiseconds: r.time_centiseconds } : undefined
        )
      }
    })
    initial[athlete.id] = flatValues
  }
  return initial
}

// Coach tool: record live workout splits for many athletes at once,
// saving straight into each athlete's log — see CLAUDE.md's "Split
// Recorder" section. `athletes` is the same alphabetically-sorted roster
// CoachAssignmentsPage already passes to AssignmentGrid; display order can
// be locally reordered (see athleteOrder below) without affecting that.
export default function SplitRecorder({ athletes, initialDate }) {
  const { showToast } = useToast()
  const [date, setDate] = useState(() => initialDate || toDateStr(new Date()))
  const [loadingDay, setLoadingDay] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [dayAssignments, setDayAssignments] = useState([])

  // Display order for this session only — never persisted, never affects
  // the alphabetical roster `athletes` itself. Reset to alphabetical every
  // time a new day loads; the coach can reorder from there with the ▲/▼
  // buttons (e.g. to match the order athletes will actually run in).
  const [athleteOrder, setAthleteOrder] = useState(() => athletes.map((a) => a.id))

  // Session-only grouping dividers, same lifetime as athleteOrder — reset
  // to none every time a new day loads. Keyed by gap index into the
  // *displayed* (orderedAthletes) list: 0 = before the first athlete, N =
  // after the last. A divider stays at its screen position when an
  // athlete is reordered across it (the ▲/▼ buttons already work
  // positionally the same way), which is the expected behavior — the line
  // marks a spot in the running order, not a specific athlete.
  const [dividers, setDividers] = useState({})

  // athleteId -> flat array of {hours,minutes,seconds}, one per that
  // athlete's OWN column (see perAthleteColumnDefs below) — never a shared
  // column set, since different athletes' columns can mean different things.
  const [entries, setEntries] = useState({})

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Live stopwatch mode — one master clock shared by the whole grid, tap a
  // name to record that athlete's next split as (clock − their own last tap
  // time), independent of every other athlete. See useStopwatch's own
  // header comment for why elapsed time is wall-clock-anchored rather than
  // tick-accumulated (accurate through a screen lock/backgrounded tab).
  const stopwatch = useStopwatch()
  const [stopwatchActive, setStopwatchActive] = useState(false)
  // athleteId -> the master clock's elapsedMs at that athlete's last tap
  // (or when the stopwatch started, for their first one) — never reset
  // except by starting a new session, so each athlete's own split history
  // is independent of when or how often anyone else was tapped.
  const [lastTapMs, setLastTapMs] = useState({})
  // Bumped on every tap and folded into each cell's key below — TimeTextInput
  // only ever reads its own `value` prop once, on mount (see that
  // component's header comment), so a tap updating `entries` from outside
  // would otherwise never be visible on screen even though the state itself
  // is correct. The same "remount via a changing key" trick this file
  // already uses for columnLayoutKey (and RecordResultsPanel for its own
  // resultsVersion).
  const [stopwatchTapVersion, setStopwatchTapVersion] = useState(0)
  // Snapshot of `entries` at the moment Start was pressed, restored by
  // Cancel Session — entries' own arrays are never mutated in place (see
  // updateCell below), so holding a reference here is enough to roll back
  // exactly, without a deep copy.
  const entriesSnapshotRef = useRef(null)

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
        setAthleteOrder(athletes.map((a) => a.id))
        setDividers({})
        const assignmentMap = new Map(assignments.map((a) => [a.athlete_id, a]))
        setEntries(buildInitialEntries(athletes, workouts, assignmentMap))
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingDay(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadDay, [date])

  const athletesById = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes])

  // Reconciled against the current roster at render time (rather than a
  // separate sync effect) — any id no longer on the roster is dropped, any
  // athlete not yet in the stored order (e.g. newly approved mid-session)
  // is appended at the end.
  const orderedAthletes = useMemo(() => {
    const known = athleteOrder.filter((id) => athletesById.has(id))
    const missing = athletes.filter((a) => !known.includes(a.id)).map((a) => a.id)
    return [...known, ...missing].map((id) => athletesById.get(id))
  }, [athleteOrder, athletes, athletesById])

  function moveAthlete(athleteId, direction) {
    setAthleteOrder((prev) => {
      const known = prev.filter((id) => athletesById.has(id))
      const missing = athletes.filter((a) => !known.includes(a.id)).map((a) => a.id)
      const full = [...known, ...missing]
      const idx = full.indexOf(athleteId)
      const swapWith = idx + direction
      if (idx === -1 || swapWith < 0 || swapWith >= full.length) return prev
      const next = full.slice()
      ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
      return next
    })
  }

  // gapIndex is a position in the *displayed* orderedAthletes list — 0
  // before the first athlete, orderedAthletes.length after the last one.
  function addDivider(gapIndex) {
    setDividers((prev) => ({ ...prev, [gapIndex]: '' }))
  }

  function updateDivider(gapIndex, label) {
    setDividers((prev) => ({ ...prev, [gapIndex]: label }))
  }

  function removeDivider(gapIndex) {
    setDividers((prev) => {
      const next = { ...prev }
      delete next[gapIndex]
      return next
    })
  }

  function updateCell(flatIndex, athleteId, value) {
    setEntries((prev) => {
      const next = (prev[athleteId] || []).slice()
      next[flatIndex] = value
      return { ...prev, [athleteId]: next }
    })
  }

  // Each athlete's own resolved type/segments/name and flattened columns —
  // computed once per athlete, straight from their own assignment. This is
  // what makes the grid show Mitch's real 200m/100m structure and Simon's
  // real 2mi/400m/200m structure side by side, each correctly labeled.
  const perAthleteResolved = useMemo(() => {
    const map = new Map()
    for (const athlete of athletes) map.set(athlete.id, resolveAthlete(athlete, assignmentByAthleteId))
    return map
  }, [athletes, assignmentByAthleteId])

  const perAthleteColumnDefs = useMemo(() => {
    const map = new Map()
    for (const athlete of athletes) {
      const resolved = perAthleteResolved.get(athlete.id)
      map.set(athlete.id, resolved ? flattenSegments(resolved.segments) : [])
    }
    return map
  }, [athletes, perAthleteResolved])

  function handleStartStopwatch() {
    entriesSnapshotRef.current = entries
    setLastTapMs({})
    stopwatch.start()
    setStopwatchActive(true)
  }

  // Ends the live clock but keeps whatever it recorded — the grid's own
  // TimeTextInput cells (already showing those values, since taps write
  // straight into the same `entries` state manual entry uses) are the
  // review step; a mis-tap is fixed there exactly like a typo would be.
  function handleFinishStopwatch() {
    stopwatch.stop()
    setStopwatchActive(false)
  }

  function handleCancelStopwatch() {
    if (entriesSnapshotRef.current) setEntries(entriesSnapshotRef.current)
    setLastTapMs({})
    stopwatch.reset()
    setStopwatchActive(false)
    setStopwatchTapVersion((v) => v + 1)
  }

  // Split value = (current master clock time − this athlete's own last tap
  // time), landed in their next open column — never the raw clock reading.
  // Each athlete's own last-tap time only ever advances on THEIR OWN tap,
  // so two athletes tapped at wildly different rates never affect each
  // other's math.
  function handleStopwatchTap(athleteId) {
    const defs = perAthleteColumnDefs.get(athleteId) || []
    const nextIndex = findNextOpenIndex(entries[athleteId] || [], defs.length)
    if (nextIndex === -1) return

    const now = stopwatch.getElapsedMs()
    const last = lastTapMs[athleteId] || 0
    updateCell(nextIndex, athleteId, msToHms(now - last))
    setLastTapMs((prev) => ({ ...prev, [athleteId]: now }))
    setStopwatchTapVersion((v) => v + 1)
  }

  // Every athlete's row is padded out to the same total column count — the
  // longest of anyone's own structure — with the extra columns beyond an
  // athlete's own (including every column, for an athlete with no
  // assignment at all that day) showing as a plain "N/A", not an editable
  // cell.
  const maxColumns = Math.max(1, ...athletes.map((a) => perAthleteColumnDefs.get(a.id)?.length || 0))
  const nobodyAssigned = athletes.every((a) => (perAthleteColumnDefs.get(a.id)?.length || 0) === 0)

  // TimeTextInput only ever reads its `value` prop once, on mount (see that
  // component) — so keying the grid on every athlete's own column count
  // (alongside `date`) forces a full remount whenever a fresh day's load
  // changes any of them, the same trick already used for switching days.
  const columnLayoutKey = `${date}-${athletes.map((a) => perAthleteColumnDefs.get(a.id)?.length || 0).join('-')}`

  // Builds this athlete's save payload from THEIR OWN resolved type/
  // segments — only the reps they actually have a time for (in order, gaps
  // simply dropped), and only segments with at least one such rep. null
  // when this athlete has nothing to record (no assignment, or every
  // column left blank).
  function buildAthletePayload(athleteId) {
    const resolved = perAthleteResolved.get(athleteId)
    if (!resolved) return null
    const defs = perAthleteColumnDefs.get(athleteId) || []
    const values = entries[athleteId] || []
    const bySegment = resolved.segments.map(() => [])
    defs.forEach((def, flatIndex) => {
      const v = values[flatIndex]
      if (v && hmsToSeconds(v) > 0) bySegment[def.segIndex].push(v)
    })
    const segments = resolved.segments
      .map((seg, i) => ({ label: seg.label, distanceValue: Number(seg.distanceValue), distanceUnit: seg.distanceUnit, repTimes: bySegment[i] }))
      .filter((s) => s.repTimes.length > 0)
    if (segments.length === 0) return null
    return { type: resolved.type, name: resolved.name, assignmentId: resolved.assignmentId, segments }
  }

  async function handleSave() {
    setSaveError('')

    const targets = athletes
      .map((athlete) => ({ athlete, payload: buildAthletePayload(athlete.id) }))
      .filter((t) => t.payload)

    if (targets.length === 0) {
      showToast('Nothing to save yet — enter at least one split time', 'error')
      return
    }

    setSaving(true)
    const errors = await mapWithConcurrency(targets, 5, async ({ athlete, payload }) => {
      await recordSplitEntry({
        athleteId: athlete.id,
        date,
        type: payload.type,
        name: payload.name,
        assignmentId: payload.assignmentId,
        segments: payload.segments,
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

  // Groups orderedAthletes into PDF sections at whatever gaps the coach
  // has placed a divider, in screen order. An athlete with nothing to
  // record (no assignment) is skipped — same "nothing to export" reasoning
  // buildAthletePayload already applies for saving. A group that ends up
  // with zero exportable athletes (e.g. a divider placed right before
  // another divider) is dropped rather than printed empty.
  function buildExportSections() {
    const groups = []
    let current = { label: '', athletes: [] }
    orderedAthletes.forEach((athlete, index) => {
      if (dividers[index] !== undefined) {
        groups.push(current)
        current = { label: dividers[index].trim() || `Group ${groups.length + 1}`, athletes: [] }
      }
      current.athletes.push(athlete)
    })
    groups.push(current)

    return groups
      .map((group) => ({
        label: group.label,
        athletes: group.athletes
          .map((athlete) => {
            const resolved = perAthleteResolved.get(athlete.id)
            if (!resolved) return null
            const defs = perAthleteColumnDefs.get(athlete.id) || []
            const values = entries[athlete.id] || []
            return {
              name: athlete.name || 'Unnamed athlete',
              cells: defs.map((def, i) => {
                const v = values[i]
                const seconds = v ? hmsToSeconds(v) : 0
                return {
                  header: `${formatDistanceValue(Number(def.seg.distanceValue) || 0, def.seg.distanceUnit)}${unitAbbrev(def.seg.distanceUnit)} (${def.repIndex + 1})`,
                  value: seconds > 0 ? secondsToClock(seconds) : '',
                }
              }),
            }
          })
          .filter(Boolean),
      }))
      .filter((group) => group.athletes.length > 0)
  }

  function handleExportPdf() {
    const sections = buildExportSections()
    if (sections.length === 0) {
      showToast('Nothing to export yet', 'error')
      return
    }
    downloadSplitRecorderPdf(date, sections)
  }

  // A full-width row spanning every column, placed between athlete blocks
  // (see gapIndex in addDivider/updateDivider/removeDivider above) — a
  // slim "+ Add divider" affordance where none exists yet, or an editable
  // group-name input once one's been added. Purely a display/export
  // grouping, never written back to any assignment.
  function renderDividerRow(gapIndex) {
    const label = dividers[gapIndex]
    if (label === undefined) {
      return (
        <div key={`divider-${gapIndex}`} className="split-recorder-divider-row split-recorder-divider-empty">
          <button type="button" className="split-recorder-divider-add" onClick={() => addDivider(gapIndex)}>
            + Add divider
          </button>
        </div>
      )
    }
    return (
      <div key={`divider-${gapIndex}`} className="split-recorder-divider-row">
        <input
          type="text"
          className="split-recorder-divider-input"
          value={label}
          placeholder="Group name (e.g. Distance, Sprinters)"
          onChange={(e) => updateDivider(gapIndex, e.target.value)}
        />
        <button
          type="button"
          className="split-recorder-divider-remove"
          onClick={() => removeDivider(gapIndex)}
          aria-label="Remove divider"
        >
          <IconX size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="split-recorder">
      <div className="split-recorder-setup">
        <label>
          Day
          <input
            type="date"
            value={date}
            disabled={stopwatchActive}
            onChange={(e) => {
              // Set together so the loading state covers the very next
              // render — otherwise there's one committed frame with the new
              // date but the previous day's still-loaded entries.
              setLoadingDay(true)
              setDate(e.target.value)
            }}
          />
        </label>
      </div>

      {loadError && <p className="form-error">{loadError}</p>}
      {saveError && <p className="form-error">{saveError}</p>}

      {loadingDay ? (
        <div className="loading-state">
          <span className="spinner" /> Loading…
        </div>
      ) : athletes.length === 0 ? (
        <p className="empty-state">No approved athletes yet.</p>
      ) : (
        <>
          {nobodyAssigned && (
            <p className="empty-state">
              No one has a running/swim/bike/other assignment for this day yet — create one first (Grid or List) to record splits
              against it.
            </p>
          )}

          {!nobodyAssigned && (
            <div className="stopwatch-panel">
              {!stopwatchActive ? (
                <button type="button" className="secondary" onClick={handleStartStopwatch}>
                  Start Stopwatch
                </button>
              ) : (
                <>
                  <div className="stopwatch-clock">{formatStopwatchClock(stopwatch.elapsedMs)}</div>
                  <div className="stopwatch-athlete-buttons">
                    {orderedAthletes.map((athlete) => {
                      const defs = perAthleteColumnDefs.get(athlete.id) || []
                      if (defs.length === 0) return null
                      const done = findNextOpenIndex(entries[athlete.id] || [], defs.length) === -1
                      return (
                        <button
                          type="button"
                          key={athlete.id}
                          className={`stopwatch-athlete-button${done ? ' stopwatch-athlete-done' : ''}`}
                          onClick={() => handleStopwatchTap(athlete.id)}
                          disabled={done}
                        >
                          {athlete.name || 'Unnamed athlete'}
                          {done && <span aria-hidden="true"> ✓</span>}
                        </button>
                      )
                    })}
                  </div>
                  <div className="stopwatch-actions">
                    <button type="button" onClick={handleFinishStopwatch}>
                      Finish Session
                    </button>
                    <button type="button" className="link-button danger" onClick={handleCancelStopwatch}>
                      Cancel Session
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="assignment-grid-wrap" key={columnLayoutKey}>
            <div
              className="split-recorder-grid"
              style={{ gridTemplateColumns: `minmax(150px, auto) repeat(${maxColumns}, minmax(90px, 1fr))` }}
            >
              {orderedAthletes.map((athlete, index) => {
                const defs = perAthleteColumnDefs.get(athlete.id) || []
                const resolved = perAthleteResolved.get(athlete.id)
                return (
                  <Fragment key={athlete.id}>
                    {renderDividerRow(index)}
                    <div className="split-recorder-name-cell" style={{ gridRow: 'span 2' }}>
                      <span className="split-recorder-reorder-buttons">
                        <button
                          type="button"
                          onClick={() => moveAthlete(athlete.id, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${athlete.name || 'athlete'} up`}
                        >
                          <IconChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveAthlete(athlete.id, 1)}
                          disabled={index === orderedAthletes.length - 1}
                          aria-label={`Move ${athlete.name || 'athlete'} down`}
                        >
                          <IconChevronDown size={14} />
                        </button>
                      </span>
                      {athlete.name || 'Unnamed athlete'}
                    </div>
                    {Array.from({ length: maxColumns }, (_, i) => {
                      const def = defs[i]
                      return (
                        <div
                          key={`h${i}`}
                          className={`split-recorder-header-cell${def?.isSegmentStart ? ' split-recorder-segment-start' : ''}`}
                        >
                          {def ? (
                            <>
                              {formatDistanceValue(Number(def.seg.distanceValue) || 0, def.seg.distanceUnit)}
                              {unitAbbrev(def.seg.distanceUnit)} ({def.repIndex + 1})
                            </>
                          ) : (
                            'N/A'
                          )}
                        </div>
                      )
                    })}
                    {Array.from({ length: maxColumns }, (_, i) => {
                      const def = defs[i]
                      if (!def) {
                        return (
                          <div key={`d${i}`} className="split-recorder-value-cell split-recorder-na-cell">
                            N/A
                          </div>
                        )
                      }
                      const prescribed = prescribedSecondsForDef(def, resolved.type)
                      return (
                        <div
                          key={`d${i}`}
                          className={`split-recorder-value-cell${def.isSegmentStart ? ' split-recorder-segment-start' : ''}`}
                        >
                          <TimeTextInput
                            key={`${athlete.id}-${i}-${stopwatchTapVersion}`}
                            value={entries[athlete.id]?.[i] || { hours: 0, minutes: 0, seconds: 0 }}
                            onChange={(v) => updateCell(i, athlete.id, v)}
                            ariaLabel={`${athlete.name || 'Athlete'} ${segmentDisplayName(def.seg)} rep ${def.repIndex + 1}`}
                            placeholder={prescribed ? secondsToClock(prescribed) : 'e.g. 6:45'}
                          />
                        </div>
                      )
                    })}
                  </Fragment>
                )
              })}
              {renderDividerRow(orderedAthletes.length)}
            </div>
          </div>
        </>
      )}

      <div className="split-recorder-actions">
        <button type="button" onClick={handleSave} disabled={saving || loadingDay}>
          {saving ? 'Saving…' : 'Save splits'}
        </button>
        <button type="button" className="secondary" onClick={handleExportPdf} disabled={loadingDay || nobodyAssigned}>
          Export as PDF
        </button>
        <span className="split-recorder-hint">Save anytime — come back later to keep adding times before it's complete.</span>
      </div>
    </div>
  )
}
