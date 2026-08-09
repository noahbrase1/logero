import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  createBikeWorkout,
  createLiftingWorkout,
  createOtherWorkout,
  createRunningWorkout,
  createSwimWorkout,
  fetchWorkoutById,
  updateBikeWorkout,
  updateLiftingWorkout,
  updateOtherWorkout,
  updateRunningWorkout,
  updateSwimWorkout,
} from '../lib/workouts'
import { fetchAssignmentById } from '../lib/assignments'
import { distanceToMeters, hmsToSeconds, metersToMiles, roundMiles, secondsToClock } from '../utils/format'
import RunningSegmentsEditor, { emptySegment } from './RunningSegmentsEditor'
import SwimSegmentsEditor, { emptySwimSegment } from './SwimSegmentsEditor'
import BikeSegmentsEditor, { emptyBikeSegment } from './BikeSegmentsEditor'
import OtherSegmentsEditor, { emptySegment as emptyOtherSegment } from './OtherSegmentsEditor'
import QuickNoteForm from './QuickNoteForm'
import { useToast } from '../context/ToastContext'

const today = () => new Date().toISOString().slice(0, 10)

const emptyExercise = () => ({ exerciseName: '', sets: '', reps: '', weight: '' })

function sumSegmentsSeconds(segments) {
  return segments.reduce((total, seg) => total + seg.repTimes.reduce((t, rt) => t + hmsToSeconds(rt), 0), 0)
}

// True only if every segment has a time recorded for every one of its reps
// — the total duration is calculated from segments and shown read-only
// (never a spot to type a total directly), and only once there's nothing
// left unfilled; a partial total would just be wrong, not merely
// approximate.
function allSegmentsComplete(segments) {
  return segments.length > 0 && segments.every((seg) => seg.repTimes.length > 0 && seg.repTimes.every((rt) => hmsToSeconds(rt) > 0))
}

function sumSegmentsDistanceMiles(segments) {
  const miles = segments.reduce((total, seg) => {
    const meters = distanceToMeters(seg.distanceValue, seg.distanceUnit)
    return total + metersToMiles(meters) * (seg.reps || 1)
  }, 0)
  return Math.round(miles * 100) / 100
}

// Builds one assignment target segment into the SegmentEditor shape used to
// prefill a new log — reads each rep's own target time back from its
// `repsField` child rows (the per-rep assigned_*_segment_reps tables), the
// same way assignmentToFormPayload does for the assignment-editing side.
// Previously this duplicated the segment-level target_time_* across every
// rep regardless of what was actually assigned per rep, so a 4x400m
// assigned at 4 different times prefilled an athlete's log with the same
// one time repeated 4 times. Falls back to that segment-level value (as a
// single rep, repeated) only for an assignment saved before per-rep target
// rows existed.
function prefillSegmentFromTarget(seg, repsField, extraFields = {}) {
  const repRows = seg[repsField] || []
  const reps = seg.reps || 1
  const repTimes =
    repRows.length > 0
      ? repRows.map((r) => ({
          hours: r.target_time_hours || 0,
          minutes: r.target_time_minutes || 0,
          seconds: r.target_time_seconds || 0,
          ...extraFields,
        }))
      : Array.from({ length: reps }, () => ({
          hours: seg.target_time_hours || 0,
          minutes: seg.target_time_minutes || 0,
          seconds: seg.target_time_seconds || 0,
          ...extraFields,
        }))

  return {
    key: crypto.randomUUID(),
    label: seg.label || '',
    distanceValue: String(seg.distance_value),
    distanceUnit: seg.distance_unit,
    reps,
    repTimes,
  }
}

// The actual create/edit workout form — extracted from what used to be the
// standalone LogWorkoutPage (still exists at /log and /edit/:workoutId as a
// thin wrapper around this, in case anything still needs a bare URL) so it
// can also be rendered inline in a Modal from the calendar, without ever
// navigating away. `workoutId` (edit) / `initialAssignmentId` + `initialDate`
// (prefill for a new log) are plain props here instead of route params/query
// string, since a modal instance has no URL of its own. `onSaved`/`onCancel`
// let the caller decide what happens next (close the modal + refresh vs.
// navigate elsewhere for the standalone-page wrapper).
export default function LogWorkoutForm({ workoutId, initialAssignmentId, initialDate, onSaved, onCancel }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const isEditing = Boolean(workoutId)

  const [entryMode, setEntryMode] = useState('structured')
  const [editingNote, setEditingNote] = useState(null)
  const [loadingWorkout, setLoadingWorkout] = useState(isEditing)
  const [loadError, setLoadError] = useState('')

  const [type, setType] = useState('running')
  const [date, setDate] = useState(initialDate || today())
  const [name, setName] = useState('')
  const [perceivedEffort, setPerceivedEffort] = useState(5)
  const [notes, setNotes] = useState('')

  const [segments, setSegments] = useState([emptySegment()])
  const [swimSegments, setSwimSegments] = useState([emptySwimSegment()])
  const [bikeSegments, setBikeSegments] = useState([emptyBikeSegment()])
  const [otherSegments, setOtherSegments] = useState([emptyOtherSegment()])

  const [exercises, setExercises] = useState([emptyExercise()])

  const [assignmentId, setAssignmentId] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const totalDistanceMiles = sumSegmentsDistanceMiles(segments)
  const totalOtherDistanceMiles = sumSegmentsDistanceMiles(otherSegments)
  // Total duration is always derived from segments — never a field the
  // athlete/coach types into directly — and only meaningful once every
  // segment's every rep has a time (see allSegmentsComplete); a partial
  // total would just be wrong, not merely approximate.
  const segmentsComplete = allSegmentsComplete(segments)
  const otherSegmentsComplete = allSegmentsComplete(otherSegments)
  const totalDurationSeconds = segmentsComplete ? sumSegmentsSeconds(segments) : 0
  const totalOtherDurationSeconds = otherSegmentsComplete ? sumSegmentsSeconds(otherSegments) : 0

  // If we arrived pre-targeted at an assignment (calendar day with a coach
  // assignment, or the assignments-style deep link), load it, switch to its
  // workout type, and prefill targets + date.
  useEffect(() => {
    if (isEditing) return
    if (initialDate) setDate(initialDate)
    if (!initialAssignmentId) return
    fetchAssignmentById(initialAssignmentId)
      .then((assignment) => {
        setType(assignment.type)
        applyAssignmentPrefill(assignment)
      })
      .catch((err) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing])

  // Editing an existing log: load it and prefill the matching form.
  useEffect(() => {
    if (!isEditing) return
    setLoadingWorkout(true)
    fetchWorkoutById(workoutId)
      .then((workout) => {
        if (workout.user_id !== user.id) {
          setLoadError('You can only edit your own logs.')
          return
        }

        if (workout.type === 'note') {
          setEntryMode('quick')
          setEditingNote({ id: workout.id, date: workout.date, notes: workout.notes })
          return
        }

        setEntryMode('structured')
        setType(workout.type)
        setDate(workout.date)
        setName(workout.name || '')
        setPerceivedEffort(workout.perceived_effort ?? 5)
        setNotes(workout.notes || '')

        if (workout.type === 'running') {
          setSegments(
            (workout.running_segments || []).map((seg) => ({
              key: crypto.randomUUID(),
              label: seg.label || '',
              distanceValue: String(seg.distance_value),
              distanceUnit: seg.distance_unit,
              reps: seg.reps || 1,
              repTimes: (seg.running_segment_reps || []).map((r) => ({
                hours: r.time_hours || 0,
                minutes: r.time_minutes || 0,
                seconds: r.time_seconds || 0,
                centiseconds: r.time_centiseconds || 0,
              })),
            }))
          )
        } else if (workout.type === 'swim') {
          setSwimSegments(
            (workout.swim_segments || []).map((seg) => ({
              key: crypto.randomUUID(),
              label: seg.label || '',
              distanceValue: String(seg.distance_value),
              distanceUnit: seg.distance_unit,
              reps: seg.reps || 1,
              repTimes: (seg.swim_segment_reps || []).map((r) => ({
                hours: r.time_hours || 0,
                minutes: r.time_minutes || 0,
                seconds: r.time_seconds || 0,
                centiseconds: r.time_centiseconds || 0,
              })),
            }))
          )
        } else if (workout.type === 'bike') {
          setBikeSegments(
            (workout.bike_segments || []).map((seg) => ({
              key: crypto.randomUUID(),
              label: seg.label || '',
              distanceValue: String(seg.distance_value),
              distanceUnit: seg.distance_unit,
              reps: seg.reps || 1,
              repTimes: (seg.bike_segment_reps || []).map((r) => ({
                hours: r.time_hours || 0,
                minutes: r.time_minutes || 0,
                seconds: r.time_seconds || 0,
                centiseconds: r.time_centiseconds || 0,
                avgWatts: r.avg_watts ?? '',
                avgCadence: r.avg_cadence ?? '',
              })),
            }))
          )
        } else if (workout.type === 'other') {
          setOtherSegments(
            (workout.other_segments || []).map((seg) => ({
              key: crypto.randomUUID(),
              label: seg.label || '',
              distanceValue: String(seg.distance_value),
              distanceUnit: seg.distance_unit,
              reps: seg.reps || 1,
              repTimes: (seg.other_segment_reps || []).map((r) => ({
                hours: r.time_hours || 0,
                minutes: r.time_minutes || 0,
                seconds: r.time_seconds || 0,
                centiseconds: r.time_centiseconds || 0,
              })),
            }))
          )
        } else {
          const mapped = (workout.lifting_exercises || []).map((ex) => ({
            exerciseName: ex.exercise_name,
            sets: ex.sets ?? '',
            reps: ex.reps ?? '',
            weight: ex.weight ?? '',
          }))
          setExercises(mapped.length > 0 ? mapped : [emptyExercise()])
        }
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingWorkout(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutId])

  function applyAssignmentPrefill(assignment) {
    setAssignmentId(assignment.id)
    if (assignment.type === 'running') {
      const targetSegments = assignment.assigned_running_segments || []
      if (targetSegments.length > 0) {
        setSegments(targetSegments.map((seg) => prefillSegmentFromTarget(seg, 'assigned_running_segment_reps')))
      }
    } else if (assignment.type === 'swim') {
      const targetSegments = assignment.assigned_swim_segments || []
      if (targetSegments.length > 0) {
        setSwimSegments(targetSegments.map((seg) => prefillSegmentFromTarget(seg, 'assigned_swim_segment_reps')))
      }
    } else if (assignment.type === 'bike') {
      const targetSegments = assignment.assigned_bike_segments || []
      if (targetSegments.length > 0) {
        setBikeSegments(
          targetSegments.map((seg) =>
            prefillSegmentFromTarget(seg, 'assigned_bike_segment_reps', { avgWatts: '', avgCadence: '' })
          )
        )
      }
    } else if (assignment.type === 'other') {
      const targetSegments = assignment.assigned_other_segments || []
      if (targetSegments.length > 0) {
        setOtherSegments(targetSegments.map((seg) => prefillSegmentFromTarget(seg, 'assigned_other_segment_reps')))
      }
    } else {
      const targets = assignment.assigned_lifting_targets || []
      if (targets.length > 0) {
        setExercises(
          targets.map((t) => ({
            exerciseName: t.exercise_name,
            sets: t.target_sets ?? '',
            reps: t.target_reps ?? '',
            weight: t.target_weight ?? '',
          }))
        )
      }
    }
  }

  function updateExercise(index, field, value) {
    setExercises((prev) => prev.map((ex, i) => (i === index ? { ...ex, [field]: value } : ex)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (type === 'running') {
        // Segments are optional — an athlete can log a run with just notes
        // (e.g. "easy recovery jog, didn't track splits") and no distance/
        // duration breakdown at all.
        const payload = {
          date,
          name,
          totalDistance: totalDistanceMiles > 0 ? totalDistanceMiles : null,
          totalDurationSeconds: totalDurationSeconds > 0 ? totalDurationSeconds : null,
          perceivedEffort: Number(perceivedEffort),
          notes,
          segments: segments.filter((s) => s.distanceValue),
        }
        if (isEditing) {
          await updateRunningWorkout(workoutId, payload)
        } else {
          await createRunningWorkout({ userId: user.id, ...payload, assignmentId: assignmentId || null })
        }
      } else if (type === 'swim') {
        const payload = {
          date,
          name,
          perceivedEffort: Number(perceivedEffort),
          notes,
          segments: swimSegments.filter((s) => s.distanceValue),
        }
        if (isEditing) {
          await updateSwimWorkout(workoutId, payload)
        } else {
          await createSwimWorkout({ userId: user.id, ...payload, assignmentId: assignmentId || null })
        }
      } else if (type === 'bike') {
        const payload = {
          date,
          name,
          perceivedEffort: Number(perceivedEffort),
          notes,
          segments: bikeSegments.filter((s) => s.distanceValue),
        }
        if (isEditing) {
          await updateBikeWorkout(workoutId, payload)
        } else {
          await createBikeWorkout({ userId: user.id, ...payload, assignmentId: assignmentId || null })
        }
      } else if (type === 'other') {
        const payload = {
          date,
          name,
          totalDistance: totalOtherDistanceMiles > 0 ? totalOtherDistanceMiles : null,
          totalDurationSeconds: totalOtherDurationSeconds > 0 ? totalOtherDurationSeconds : null,
          perceivedEffort: Number(perceivedEffort),
          notes,
          segments: otherSegments.filter((s) => s.distanceValue),
        }
        if (isEditing) {
          await updateOtherWorkout(workoutId, payload)
        } else {
          await createOtherWorkout({ userId: user.id, ...payload, assignmentId: assignmentId || null })
        }
      } else {
        const payload = {
          date,
          name,
          perceivedEffort: Number(perceivedEffort),
          notes,
          exercises: exercises.map((ex) => ({
            exerciseName: ex.exerciseName,
            sets: ex.sets ? Number(ex.sets) : null,
            reps: ex.reps ? Number(ex.reps) : null,
            weight: ex.weight ? Number(ex.weight) : null,
          })),
        }
        if (isEditing) {
          await updateLiftingWorkout(workoutId, payload)
        } else {
          await createLiftingWorkout({ userId: user.id, ...payload, assignmentId: assignmentId || null })
        }
      }

      showToast(isEditing ? 'Workout updated!' : 'Workout logged!')
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="log-workout-form">
      <h3 id="log-workout-modal-heading">{isEditing ? 'Edit workout' : 'Log a workout'}</h3>

      {loadingWorkout ? (
        <div className="loading-state">
          <span className="spinner" /> Loading…
        </div>
      ) : loadError ? (
        <p className="form-error">{loadError}</p>
      ) : (
        <>
          {!isEditing && (
            <div className="type-toggle">
              <button
                type="button"
                className={entryMode === 'structured' ? 'active' : ''}
                onClick={() => setEntryMode('structured')}
              >
                Structured Log
              </button>
              <button
                type="button"
                className={entryMode === 'quick' ? 'active' : ''}
                onClick={() => setEntryMode('quick')}
              >
                Quick Note
              </button>
            </div>
          )}

          {entryMode === 'quick' ? (
            <QuickNoteForm
              editingNote={editingNote}
              onPosted={() => {
                showToast(isEditing ? 'Note updated!' : 'Note posted!')
                onSaved()
              }}
            />
          ) : (
            <form className="workout-form" onSubmit={handleSubmit}>
              <div className="form-row">
                <label>
                  Date
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </label>
                <label>
                  {type === 'other' ? 'Activity name' : 'Workout name'}
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      type === 'running'
                        ? 'Tempo run'
                        : type === 'swim'
                          ? 'Swim practice'
                          : type === 'bike'
                            ? 'Bike ride'
                            : type === 'other'
                              ? 'Rowing'
                              : 'Leg day'
                    }
                    required
                  />
                </label>
              </div>

              {!isEditing && (
                <div className="type-toggle">
                  <button
                    type="button"
                    className={type === 'running' ? 'active' : ''}
                    onClick={() => setType('running')}
                  >
                    Running
                  </button>
                  <button type="button" className={type === 'swim' ? 'active' : ''} onClick={() => setType('swim')}>
                    Swimming
                  </button>
                  <button type="button" className={type === 'bike' ? 'active' : ''} onClick={() => setType('bike')}>
                    Cycling
                  </button>
                  <button
                    type="button"
                    className={type === 'lifting' ? 'active' : ''}
                    onClick={() => setType('lifting')}
                  >
                    Lifting
                  </button>
                  <button
                    type="button"
                    className={type === 'other' ? 'active' : ''}
                    onClick={() => setType('other')}
                  >
                    Other
                  </button>
                </div>
              )}

              {type === 'running' ? (
                <>
                  <RunningSegmentsEditor segments={segments} onChange={setSegments} />

                  <div className="total-duration-row">
                    <div>
                      <span className="total-duration-label">Total distance</span>
                      <span className="total-duration-value">
                        {totalDistanceMiles > 0 ? `${roundMiles(totalDistanceMiles)} mi` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="total-duration-label">Total duration</span>
                      <span className="total-duration-value">
                        {segmentsComplete ? secondsToClock(totalDurationSeconds) : '—'}
                      </span>
                    </div>
                  </div>
                </>
              ) : type === 'swim' ? (
                <SwimSegmentsEditor segments={swimSegments} onChange={setSwimSegments} />
              ) : type === 'bike' ? (
                <BikeSegmentsEditor segments={bikeSegments} onChange={setBikeSegments} />
              ) : type === 'other' ? (
                <>
                  <OtherSegmentsEditor segments={otherSegments} onChange={setOtherSegments} />

                  <div className="total-duration-row">
                    <div>
                      <span className="total-duration-label">Total distance</span>
                      <span className="total-duration-value">
                        {totalOtherDistanceMiles > 0 ? `${roundMiles(totalOtherDistanceMiles)} mi` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="total-duration-label">Total duration</span>
                      <span className="total-duration-value">
                        {otherSegmentsComplete ? secondsToClock(totalOtherDurationSeconds) : '—'}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <fieldset className="splits-fieldset">
                  <legend>Exercises</legend>
                  {exercises.map((ex, i) => (
                    <div className="form-row exercise-row" key={i}>
                      <label>
                        Exercise
                        <input
                          type="text"
                          placeholder="Back squat"
                          value={ex.exerciseName}
                          onChange={(e) => updateExercise(i, 'exerciseName', e.target.value)}
                        />
                      </label>
                      <label>
                        Sets
                        <input
                          type="number"
                          min="0"
                          value={ex.sets}
                          onChange={(e) => updateExercise(i, 'sets', e.target.value)}
                        />
                      </label>
                      <label>
                        Reps
                        <input
                          type="number"
                          min="0"
                          value={ex.reps}
                          onChange={(e) => updateExercise(i, 'reps', e.target.value)}
                        />
                      </label>
                      <label>
                        Weight (lb)
                        <input
                          type="number"
                          min="0"
                          value={ex.weight}
                          onChange={(e) => updateExercise(i, 'weight', e.target.value)}
                        />
                      </label>
                      {exercises.length > 1 && (
                        <button
                          type="button"
                          className="remove-row"
                          onClick={() => setExercises((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label="Remove exercise"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="add-row"
                    onClick={() => setExercises((prev) => [...prev, emptyExercise()])}
                  >
                    + Add exercise
                  </button>
                </fieldset>
              )}

              <div className="form-row">
                <label className="effort-label">
                  Perceived effort: {perceivedEffort}/10
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={perceivedEffort}
                    onChange={(e) => setPerceivedEffort(e.target.value)}
                  />
                </label>
              </div>

              <label>
                Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </label>

              {error && <p className="form-error">{error}</p>}

              <div className="form-row">
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Save workout'}
                </button>
                {onCancel && (
                  <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}
