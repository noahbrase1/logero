import { ASSIGNED_SEGMENTS_FIELD_BY_TYPE, assignedWorkoutHeadline } from '../utils/format'
import { SegmentLine, liftingTargetSummary } from './WorkoutCard'

// The not-yet-logged twin of WorkoutCard's own "Prescribed" block — used by
// the athlete calendar's day panel when a day has an assignment but nothing
// has been logged against it yet. Same minimal-thumbnail-plus-dropdown
// shape as a logged WorkoutCard: distance (+ total time, only when every
// target rep actually has one) collapsed, a "View splits"/"View sets"
// toggle revealing each segment's own prescribed line, shown whenever
// there's any target data at all.
export default function AssignedWorkoutSummary({ assignment }) {
  if (!assignment) return null

  if (assignment.type === 'lifting') {
    const targets = assignment.assigned_lifting_targets || []
    if (targets.length === 0) return null

    if (targets.length === 1) {
      return <div className="workout-headline-meta">Prescribed: {liftingTargetSummary(targets[0])}</div>
    }

    return (
      <details className="workout-details">
        <summary>View sets</summary>
        <table className="detail-table">
          <thead>
            <tr>
              <th>Exercise</th>
              <th>Sets</th>
              <th>Reps</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id}>
                <td>{t.exercise_name}</td>
                <td>{t.target_sets ?? '—'}</td>
                <td>{t.target_reps ?? '—'}</td>
                <td>{t.target_weight ? `${t.target_weight} lb` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    )
  }

  const targetField = ASSIGNED_SEGMENTS_FIELD_BY_TYPE[assignment.type]
  const targetSegments = targetField ? assignment[targetField] || [] : []
  if (targetSegments.length === 0) return null

  const headline = assignedWorkoutHeadline(assignment)

  return (
    <>
      <div className="workout-headline">Prescribed: {headline.length > 0 ? headline.join(' @ ') : '—'}</div>
      <details className="workout-details">
        <summary>View splits</summary>
        <div className="segment-list">
          {targetSegments.map((seg) => (
            <div className="segment-summary" key={seg.id}>
              <SegmentLine seg={seg} type={assignment.type} kind="target" />
            </div>
          ))}
        </div>
      </details>
    </>
  )
}
