import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { createAssignment, fetchAssignmentsForCoach } from '../lib/assignments'
import { fetchApprovedAthletes } from '../lib/workouts'
import { formatDate, unitAbbrev, workoutTypeLabel } from '../utils/format'
import AssignedSegmentsEditor, { emptyAssignedSegment } from '../components/AssignedSegmentsEditor'
import AssignedSwimSegmentsEditor, { emptyAssignedSwimSegment } from '../components/AssignedSwimSegmentsEditor'
import AssignedBikeSegmentsEditor, { emptyAssignedBikeSegment } from '../components/AssignedBikeSegmentsEditor'
import { useToast } from '../context/ToastContext'

const today = () => new Date().toISOString().slice(0, 10)
const emptyExercise = () => ({ exerciseName: '', targetSets: '', targetReps: '', targetWeight: '' })

export default function CoachAssignmentsPage() {
  const { user, profile } = useAuth()
  const canCreate = profile?.role === 'coach'
  const { showToast } = useToast()
  const [athletes, setAthletes] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selectedAthleteIds, setSelectedAthleteIds] = useState(new Set())
  const [type, setType] = useState('running')
  const [date, setDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [runningSegments, setRunningSegments] = useState([emptyAssignedSegment()])
  const [swimSegments, setSwimSegments] = useState([emptyAssignedSwimSegment()])
  const [bikeSegments, setBikeSegments] = useState([emptyAssignedBikeSegment()])
  const [liftingTargets, setLiftingTargets] = useState([emptyExercise()])
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  function load() {
    setLoading(true)
    Promise.all([fetchApprovedAthletes(), fetchAssignmentsForCoach()])
      .then(([a, w]) => {
        setAthletes(a)
        setAssignments(w)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  function updateLiftingTarget(index, field, value) {
    setLiftingTargets((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)))
  }

  function toggleAthlete(id) {
    setSelectedAthleteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllAthletes() {
    setSelectedAthleteIds(new Set(athletes.map((a) => a.id)))
  }

  function clearAthleteSelection() {
    setSelectedAthleteIds(new Set())
  }

  function resetForm() {
    setNotes('')
    setRunningSegments([emptyAssignedSegment()])
    setSwimSegments([emptyAssignedSwimSegment()])
    setBikeSegments([emptyAssignedBikeSegment()])
    setLiftingTargets([emptyExercise()])
    setSelectedAthleteIds(new Set())
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const targetAthleteIds = Array.from(selectedAthleteIds)
    if (targetAthleteIds.length === 0) {
      setError('Select at least one athlete.')
      return
    }

    setSaving(true)
    try {
      for (const id of targetAthleteIds) {
        await createAssignment({
          coachId: user.id,
          athleteId: id,
          type,
          date,
          notes,
          runningSegments: type === 'running' ? runningSegments : [],
          swimSegments: type === 'swim' ? swimSegments : [],
          bikeSegments: type === 'bike' ? bikeSegments : [],
          liftingTargets:
            type === 'lifting'
              ? liftingTargets.map((t) => ({
                  exerciseName: t.exerciseName,
                  targetSets: t.targetSets ? Number(t.targetSets) : null,
                  targetReps: t.targetReps ? Number(t.targetReps) : null,
                  targetWeight: t.targetWeight ? Number(t.targetWeight) : null,
                }))
              : [],
        })
      }

      const message =
        targetAthleteIds.length > 1 ? `Assigned to ${targetAthleteIds.length} athletes.` : 'Assignment created.'
      setSuccess(message)
      showToast(message)
      resetForm()
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h1>Assigned workouts</h1>

      {canCreate && (
      <form className="workout-form" onSubmit={handleSubmit}>
        <fieldset className="splits-fieldset">
          <legend>Athletes</legend>
          <div className="athlete-checklist-actions">
            <button type="button" className="link-button" onClick={selectAllAthletes}>
              Select all
            </button>
            <button type="button" className="link-button" onClick={clearAthleteSelection}>
              Clear
            </button>
          </div>
          {athletes.length === 0 && <p className="empty-state">No approved athletes yet.</p>}
          <div className="athlete-checklist">
            {athletes.map((a) => (
              <label key={a.id} className="athlete-checklist-item">
                <input
                  type="checkbox"
                  checked={selectedAthleteIds.has(a.id)}
                  onChange={() => toggleAthlete(a.id)}
                />
                {a.name || 'Unnamed athlete'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="form-row">
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
        </div>

        <div className="type-toggle">
          <button type="button" className={type === 'running' ? 'active' : ''} onClick={() => setType('running')}>
            Running
          </button>
          <button type="button" className={type === 'swim' ? 'active' : ''} onClick={() => setType('swim')}>
            Swimming
          </button>
          <button type="button" className={type === 'bike' ? 'active' : ''} onClick={() => setType('bike')}>
            Cycling
          </button>
          <button type="button" className={type === 'lifting' ? 'active' : ''} onClick={() => setType('lifting')}>
            Lifting
          </button>
        </div>

        {type === 'running' ? (
          <AssignedSegmentsEditor segments={runningSegments} onChange={setRunningSegments} />
        ) : type === 'swim' ? (
          <AssignedSwimSegmentsEditor segments={swimSegments} onChange={setSwimSegments} />
        ) : type === 'bike' ? (
          <AssignedBikeSegmentsEditor segments={bikeSegments} onChange={setBikeSegments} />
        ) : (
          <fieldset className="splits-fieldset">
            <legend>Target exercises</legend>
            {liftingTargets.map((t, i) => (
              <div className="form-row exercise-row" key={i}>
                <label>
                  Exercise
                  <input
                    type="text"
                    placeholder="Back squat"
                    value={t.exerciseName}
                    onChange={(e) => updateLiftingTarget(i, 'exerciseName', e.target.value)}
                  />
                </label>
                <label>
                  Sets
                  <input
                    type="number"
                    min="0"
                    value={t.targetSets}
                    onChange={(e) => updateLiftingTarget(i, 'targetSets', e.target.value)}
                  />
                </label>
                <label>
                  Reps
                  <input
                    type="number"
                    min="0"
                    value={t.targetReps}
                    onChange={(e) => updateLiftingTarget(i, 'targetReps', e.target.value)}
                  />
                </label>
                <label>
                  Weight (lb)
                  <input
                    type="number"
                    min="0"
                    value={t.targetWeight}
                    onChange={(e) => updateLiftingTarget(i, 'targetWeight', e.target.value)}
                  />
                </label>
                {liftingTargets.length > 1 && (
                  <button
                    type="button"
                    className="remove-row"
                    onClick={() => setLiftingTargets((prev) => prev.filter((_, idx) => idx !== i))}
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
              onClick={() => setLiftingTargets((prev) => [...prev, emptyExercise()])}
            >
              + Add exercise
            </button>
          </fieldset>
        )}

        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>

        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-info">{success}</p>}

        <button type="submit" disabled={saving}>
          {saving ? 'Assigning…' : 'Create assignment'}
        </button>
      </form>
      )}

      <h2 className="events-section-heading">All assignments</h2>
      {loading && (
        <div className="loading-state">
          <span className="spinner" /> Loading…
        </div>
      )}
      {!loading && assignments.length === 0 && (
        <p className="empty-state">No assignments yet — create one above to get started.</p>
      )}
      <div className="assignments-list">
        {assignments.map((a) => (
          <div key={a.id} className="assignment-row">
            <div>
              <span className={`type-badge type-${a.type}`}>{workoutTypeLabel(a.type)}</span>
              <span className="assignment-athlete">{a.profiles?.name || 'Unknown athlete'}</span>
              <span className="workout-date">{formatDate(a.date)}</span>
            </div>
            <div className="assignment-target-summary">
              {a.type === 'running' && a.assigned_running_segments?.length > 0 && (
                <span>
                  {a.assigned_running_segments
                    .map(
                      (seg) =>
                        `${seg.label ? `${seg.label}: ` : ''}${seg.reps > 1 ? `${seg.reps}×` : ''}${seg.distance_value}${unitAbbrev(seg.distance_unit)}`
                    )
                    .join(', ')}
                </span>
              )}
              {a.type === 'swim' && a.assigned_swim_segments?.length > 0 && (
                <span>
                  {a.assigned_swim_segments
                    .map(
                      (seg) =>
                        `${seg.label ? `${seg.label}: ` : ''}${seg.reps > 1 ? `${seg.reps}×` : ''}${seg.distance_value}${unitAbbrev(seg.distance_unit)}`
                    )
                    .join(', ')}
                </span>
              )}
              {a.type === 'bike' && a.assigned_bike_segments?.length > 0 && (
                <span>
                  {a.assigned_bike_segments
                    .map(
                      (seg) =>
                        `${seg.label ? `${seg.label}: ` : ''}${seg.reps > 1 ? `${seg.reps}×` : ''}${seg.distance_value}${unitAbbrev(seg.distance_unit)}`
                    )
                    .join(', ')}
                </span>
              )}
              {a.type === 'lifting' && a.assigned_lifting_targets?.length > 0 && (
                <span>{a.assigned_lifting_targets.map((t) => t.exercise_name).join(', ')}</span>
              )}
            </div>
            <span className={`status-badge status-${a.status}`}>{a.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
