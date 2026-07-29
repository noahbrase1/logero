import { assignedWorkoutHeadline } from '../utils/format'
import { ASSIGNED_SEGMENTS_FIELD_BY_TYPE, PrescribedSegmentSummary, liftingTargetSummary } from './WorkoutCard'

// The not-yet-logged twin of WorkoutCard's own "Prescribed" block — used by
// the athlete calendar's day panel when a day has an assignment but nothing
// has been logged against it yet. Follows the exact same collapse rules
// (compact headline, "View splits"/"View sets" only when there's genuine
// multi-segment/multi-exercise detail to reveal) so a coach or athlete sees
// the same shape whether or not something's been logged for the day.
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
  const showSplitsToggle = targetSegments.length > 1 || targetSegments.some((seg) => (seg.reps || 1) > 1)

  return (
    <>
      <div className="workout-headline">{headline.length > 0 ? headline.join(' · ') : '—'}</div>
      {showSplitsToggle && (
        <details className="workout-details">
          <summary>View splits</summary>
          <div className="segment-list">
            {targetSegments.map((seg) => (
              <PrescribedSegmentSummary key={seg.id} seg={seg} type={assignment.type} />
            ))}
          </div>
        </details>
      )}
    </>
  )
}
