import { formatDateHeading, summarizeAssignment, workoutTypeLabel } from '../utils/format'
import WorkoutTypeIcon from './WorkoutTypeIcon'

// One card per day for the Assignments List view — a date header (with
// that day's workout count) followed by one row per athlete's assignment:
// icon, name, workout type, distance/summary, status. Deliberately does
// NOT collapse identical workouts across athletes the way
// groupAssignmentsByWorkout() does for ExportDayModal/SplitRecorder — a
// coach reviewing "who has what today" needs every athlete's own row, not
// a merged group.
export default function AssignmentDayGroup({ dateStr, assignments }) {
  return (
    <div className="assignment-day-group">
      <div className="assignment-day-header">
        <span className="assignment-day-date">{formatDateHeading(dateStr)}</span>
        <span className="assignment-day-count">
          {assignments.length} workout{assignments.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="assignment-day-rows">
        {assignments.map((a) => (
          <div key={a.id} className={`assignment-athlete-row card-accent-${a.type}`}>
            <WorkoutTypeIcon type={a.type} />
            <span className="assignment-athlete">{a.profiles?.name || 'Unknown athlete'}</span>
            <span className={`type-badge type-${a.type}`}>{workoutTypeLabel(a.type)}</span>
            <span className="assignment-target-summary">{summarizeAssignment(a)}</span>
            <span className={`status-badge status-${a.status}`}>{a.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
