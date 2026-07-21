import { useState } from 'react'
import AssignedSegmentsEditor, { emptyAssignedSegment } from './AssignedSegmentsEditor'
import AssignedSwimSegmentsEditor, { emptyAssignedSwimSegment } from './AssignedSwimSegmentsEditor'
import AssignedBikeSegmentsEditor, { emptyAssignedBikeSegment } from './AssignedBikeSegmentsEditor'

const emptyExercise = () => ({ exerciseName: '', targetSets: '', targetReps: '', targetWeight: '' })

// The single-assignment sub-form (sport-type toggle + segment/target editor
// + notes) — extracted from CoachAssignmentsPage so it isn't duplicated a
// third time for the assignment grid's per-cell modal. Athlete selection and
// "submit to N athletes" stay with each caller; this only ever assembles
// and hands back one assignment's payload, in the exact shape
// createAssignment() expects.
//
// `initialPayload` (optional — omitted for a brand-new assignment): the
// shape assignmentToFormPayload() returns, i.e.
// { type, notes, runningSegments, swimSegments, bikeSegments, liftingTargets }.
export default function AssignmentForm({ initialPayload, onSubmit, onCancel, submitLabel, saving, error }) {
  const [type, setType] = useState(initialPayload?.type || 'running')
  const [notes, setNotes] = useState(initialPayload?.notes || '')
  const [runningSegments, setRunningSegments] = useState(
    initialPayload?.runningSegments?.length ? initialPayload.runningSegments : [emptyAssignedSegment()]
  )
  const [swimSegments, setSwimSegments] = useState(
    initialPayload?.swimSegments?.length ? initialPayload.swimSegments : [emptyAssignedSwimSegment()]
  )
  const [bikeSegments, setBikeSegments] = useState(
    initialPayload?.bikeSegments?.length ? initialPayload.bikeSegments : [emptyAssignedBikeSegment()]
  )
  const [liftingTargets, setLiftingTargets] = useState(
    initialPayload?.liftingTargets?.length ? initialPayload.liftingTargets : [emptyExercise()]
  )

  function updateLiftingTarget(index, field, value) {
    setLiftingTargets((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)))
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit({
      type,
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

  return (
    <form className="workout-form" onSubmit={handleSubmit}>
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
          <button type="button" className="add-row" onClick={() => setLiftingTargets((prev) => [...prev, emptyExercise()])}>
            + Add exercise
          </button>
        </fieldset>
      )}

      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="form-row">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
