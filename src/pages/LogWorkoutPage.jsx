import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  createBikeWorkout,
  createLiftingWorkout,
  createRunningWorkout,
  createSwimWorkout,
  fetchWorkoutById,
  updateBikeWorkout,
  updateLiftingWorkout,
  updateRunningWorkout,
  updateSwimWorkout,
} from '../lib/workouts'
import { fetchAssignmentById, fetchOpenAssignments } from '../lib/assignments'
import { distanceToMeters, hmsToSeconds, metersToMiles, secondsToHms } from '../utils/format'
import RunningSegmentsEditor, { emptySegment } from '../components/RunningSegmentsEditor'
import SwimSegmentsEditor, { emptySwimSegment } from '../components/SwimSegmentsEditor'
import BikeSegmentsEditor, { emptyBikeSegment } from '../components/BikeSegmentsEditor'
import TimeTextInput from '../components/TimeTextInput'
import QuickNoteForm from '../components/QuickNoteForm'
import { useToast } from '../context/ToastContext'

const today = () => new Date().toISOString().slice(0, 10)

const emptyExercise = () => ({ exerciseName: '', sets: '', reps: '', weight: '' })

function sumSegmentsSeconds(segments) {
  return segments.reduce((total, seg) => total + seg.repTimes.reduce((t, rt) => t + hmsToSeconds(rt), 0), 0)
}

function sumSegmentsDistanceMiles(segments) {
  const miles = segments.reduce((total, seg) => {
    const meters = distanceToMeters(seg.distanceValue, seg.distanceUnit)
    return total + metersToMiles(meters) * (seg.reps || 1)
  }, 0)
  return Math.round(miles * 100) / 100
}

export default function LogWorkoutPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const { workoutId } = useParams()
  const navigate = useNavigate()
  const isEditing = Boolean(workoutId)
  const [searchParams, setSearchParams] = useSearchParams()

  const [entryMode, setEntryMode] = useState('structured')
  const [noteSuccess, setNoteSuccess] = useState('')
  const [editingNote, setEditingNote] = useState(null)
  const [loadingWorkout, setLoadingWorkout] = useState(isEditing)
  const [loadError, setLoadError] = useState('')

  const [type, setType] = useState('running')
  const [date, setDate] = useState(today())
  const [name, setName] = useState('')
  const [perceivedEffort, setPerceivedEffort] = useState(5)
  const [notes, setNotes] = useState('')

  const [segments, setSegments] = useState([emptySegment()])
  const [swimSegments, setSwimSegments] = useState([emptySwimSegment()])
  const [bikeSegments, setBikeSegments] = useState([emptyBikeSegment()])
  const [totalDuration, setTotalDuration] = useState({ hours: 0, minutes: 0, seconds: 0 })
  const [totalDurationManual, setTotalDurationManual] = useState(false)
  // Bumped only on *programmatic* total-duration changes (auto-sum, prefill,
  // reset) to force the TimeTextInput to remount and show the new value —
  // never on the athlete's own typing, so their input isn't disrupted.
  const [totalDurationResetKey, setTotalDurationResetKey] = useState(0)

  const [exercises, setExercises] = useState([emptyExercise()])

  const [openAssignments, setOpenAssignments] = useState([])
  const [assignmentId, setAssignmentId] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const totalDistanceMiles = sumSegmentsDistanceMiles(segments)

  // Keep total duration in sync with the segments unless the athlete has
  // manually overridden it (e.g. to account for rest/cooldown time).
  useEffect(() => {
    if (totalDurationManual) return
    setTotalDuration(secondsToHms(sumSegmentsSeconds(segments)))
    setTotalDurationResetKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, totalDurationManual])

  function recalcTotalFromSegments() {
    setTotalDurationManual(false)
    setTotalDuration(secondsToHms(sumSegmentsSeconds(segments)))
    setTotalDurationResetKey((k) => k + 1)
  }

  useEffect(() => {
    if (isEditing) return
    fetchOpenAssignments(user.id, type)
      .then(setOpenAssignments)
      .catch((err) => setError(err.message))
  }, [user.id, type, isEditing])

  // If we arrived from the assignments to-do list (`?assignmentId=...`), load
  // that specific assignment, switch to its workout type, and prefill targets.
  useEffect(() => {
    if (isEditing) return
    const paramId = searchParams.get('assignmentId')
    if (!paramId) return
    fetchAssignmentById(paramId)
      .then((assignment) => {
        setType(assignment.type)
        applyAssignmentPrefill(assignment)
        setSearchParams({}, { replace: true })
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
              })),
            }))
          )
          setTotalDuration(secondsToHms(workout.total_duration_seconds || 0))
          setTotalDurationManual(true)
          setTotalDurationResetKey((k) => k + 1)
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
                avgWatts: r.avg_watts ?? '',
                avgCadence: r.avg_cadence ?? '',
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
        setSegments(
          targetSegments.map((seg) => {
            const repTime = {
              hours: seg.target_time_hours || 0,
              minutes: seg.target_time_minutes || 0,
              seconds: seg.target_time_seconds || 0,
            }
            const reps = seg.reps || 1
            return {
              key: crypto.randomUUID(),
              label: seg.label || '',
              distanceValue: String(seg.distance_value),
              distanceUnit: seg.distance_unit,
              reps,
              repTimes: Array.from({ length: reps }, () => ({ ...repTime })),
            }
          })
        )
        setTotalDurationManual(false)
      }
    } else if (assignment.type === 'swim') {
      const targetSegments = assignment.assigned_swim_segments || []
      if (targetSegments.length > 0) {
        setSwimSegments(
          targetSegments.map((seg) => {
            const repTime = {
              hours: seg.target_time_hours || 0,
              minutes: seg.target_time_minutes || 0,
              seconds: seg.target_time_seconds || 0,
            }
            const reps = seg.reps || 1
            return {
              key: crypto.randomUUID(),
              label: seg.label || '',
              distanceValue: String(seg.distance_value),
              distanceUnit: seg.distance_unit,
              reps,
              repTimes: Array.from({ length: reps }, () => ({ ...repTime })),
            }
          })
        )
      }
    } else if (assignment.type === 'bike') {
      const targetSegments = assignment.assigned_bike_segments || []
      if (targetSegments.length > 0) {
        setBikeSegments(
          targetSegments.map((seg) => {
            const repTime = {
              hours: seg.target_time_hours || 0,
              minutes: seg.target_time_minutes || 0,
              seconds: seg.target_time_seconds || 0,
              avgWatts: '',
              avgCadence: '',
            }
            const reps = seg.reps || 1
            return {
              key: crypto.randomUUID(),
              label: seg.label || '',
              distanceValue: String(seg.distance_value),
              distanceUnit: seg.distance_unit,
              reps,
              repTimes: Array.from({ length: reps }, () => ({ ...repTime })),
            }
          })
        )
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

  function handleAssignmentSelect(id) {
    setAssignmentId(id)
    if (!id) return
    const assignment = openAssignments.find((a) => a.id === id)
    if (assignment) applyAssignmentPrefill(assignment)
  }

  function resetForm() {
    setName('')
    setPerceivedEffort(5)
    setNotes('')
    setSegments([emptySegment()])
    setSwimSegments([emptySwimSegment()])
    setBikeSegments([emptyBikeSegment()])
    setTotalDuration({ hours: 0, minutes: 0, seconds: 0 })
    setTotalDurationManual(false)
    setExercises([emptyExercise()])
    setAssignmentId('')
  }

  function updateExercise(index, field, value) {
    setExercises((prev) => prev.map((ex, i) => (i === index ? { ...ex, [field]: value } : ex)))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const totalDurationSeconds = hmsToSeconds(totalDuration)

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

      if (isEditing) {
        showToast('Workout updated!')
        navigate('/history')
        return
      }
      setSuccess('Workout logged!')
      setNoteSuccess('')
      showToast('Workout logged!')
      resetForm()
      fetchOpenAssignments(user.id, type).then(setOpenAssignments)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h1>{isEditing ? 'Edit workout' : 'Log a workout'}</h1>

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
                if (isEditing) {
                  showToast('Note updated!')
                  navigate('/history')
                } else {
                  setNoteSuccess('Note posted!')
                  showToast('Note posted!')
                }
              }}
            />
          ) : (
            <>
              {noteSuccess && <p className="form-info">{noteSuccess}</p>}
              {!isEditing && (
                <div className="type-toggle">
                  <button
                    type="button"
                    className={type === 'running' ? 'active' : ''}
                    onClick={() => setType('running')}
                  >
                    Running
                  </button>
                  <button
                    type="button"
                    className={type === 'swim' ? 'active' : ''}
                    onClick={() => setType('swim')}
                  >
                    Swimming
                  </button>
                  <button
                    type="button"
                    className={type === 'bike' ? 'active' : ''}
                    onClick={() => setType('bike')}
                  >
                    Cycling
                  </button>
                  <button
                    type="button"
                    className={type === 'lifting' ? 'active' : ''}
                    onClick={() => setType('lifting')}
                  >
                    Lifting
                  </button>
                </div>
              )}

              <form className="workout-form" onSubmit={handleSubmit}>
                <div className="form-row">
                  <label>
                    Date
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                  </label>
                  <label>
                    Workout name
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
                              : 'Leg day'
                      }
                      required
                    />
                  </label>
                </div>

                {!isEditing && openAssignments.length > 0 && (
                  <label>
                    Fulfills assignment (optional)
                    <select value={assignmentId} onChange={(e) => handleAssignmentSelect(e.target.value)}>
                      <option value="">— None —</option>
                      {openAssignments.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.date} {a.notes ? `— ${a.notes}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {type === 'running' ? (
                  <>
                    <RunningSegmentsEditor segments={segments} onChange={setSegments} />

                    <div className="total-duration-row">
                      <div>
                        <span className="total-duration-label">Total distance</span>
                        <span className="total-duration-value">
                          {totalDistanceMiles > 0 ? `${totalDistanceMiles} mi` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="total-duration-label">Total duration</span>
                        <TimeTextInput
                          key={totalDurationResetKey}
                          value={totalDuration}
                          onChange={(v) => {
                            setTotalDuration(v)
                            setTotalDurationManual(true)
                          }}
                          ariaLabel="Total workout duration"
                        />
                        {totalDurationManual && (
                          <button type="button" className="link-button" onClick={recalcTotalFromSegments}>
                            Recalculate from segments
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                ) : type === 'swim' ? (
                  <SwimSegmentsEditor segments={swimSegments} onChange={setSwimSegments} />
                ) : type === 'bike' ? (
                  <BikeSegmentsEditor segments={bikeSegments} onChange={setBikeSegments} />
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
                {success && <p className="form-info">{success}</p>}

                <button type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Save workout'}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </div>
  )
}
