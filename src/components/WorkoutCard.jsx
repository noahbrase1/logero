import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  ASSIGNED_REPS_FIELD_BY_TYPE,
  ASSIGNED_SEGMENTS_FIELD_BY_TYPE,
  LOGGED_REPS_FIELD_BY_TYPE,
  assignedWorkoutHeadline,
  formatDate,
  formatDistanceValue,
  formatRepTimesList,
  hmsToSeconds,
  loggedWorkoutHeadline,
  summarizeBikeReps,
  unitAbbrev,
  workoutTypeLabel,
} from '../utils/format'
import WorkoutComments from './WorkoutComments'
import TargetVsActual from './TargetVsActual'
import WorkoutTypeIcon from './WorkoutTypeIcon'

// `hideEditLink` lets a caller that already provides its own edit affordance
// (the athlete calendar's in-modal "Edit workout" button, see
// EventCalendar.jsx) suppress this card's own full-page Edit link, so a day
// panel doesn't offer two different ways to edit the same log.
export default function WorkoutCard({ workout, showAthleteName = false, hideEditLink = false }) {
  const { user, profile } = useAuth()
  const isRunning = workout.type === 'running'
  const isSwim = workout.type === 'swim'
  const isBike = workout.type === 'bike'
  const isOther = workout.type === 'other'
  const canEdit = profile?.role === 'athlete' && user?.id === workout.user_id && !hideEditLink

  return (
    <article className={`workout-card card-accent-${workout.type}`}>
      <div className="workout-card-header">
        <div>
          <div className="workout-card-title-row">
            <WorkoutTypeIcon type={workout.type} />
            <span className={`type-badge type-${workout.type}`}>{workoutTypeLabel(workout.type)}</span>
          </div>
          <h3>{workout.name}</h3>
        </div>
        <div className="workout-card-meta">
          {showAthleteName && workout.profiles?.name && (
            <span className="athlete-name">{workout.profiles.name}</span>
          )}
          <span className="workout-date">{formatDate(workout.date)}</span>
          {canEdit && (
            <Link to={`/edit/${workout.id}`} className="link-button">
              Edit
            </Link>
          )}
        </div>
      </div>

      {isRunning ? (
        <ActualAndPrescribed workout={workout} segments={workout.running_segments} />
      ) : isSwim ? (
        <ActualAndPrescribed workout={workout} segments={workout.swim_segments} />
      ) : isBike ? (
        <ActualAndPrescribed workout={workout} segments={workout.bike_segments} />
      ) : isOther ? (
        <ActualAndPrescribed workout={workout} segments={workout.other_segments} />
      ) : (
        <LiftingBody workout={workout} />
      )}

      {workout.notes && <p className="workout-notes">{workout.notes}</p>}

      <WorkoutComments workoutId={workout.id} />
    </article>
  )
}

// Shared body for running/swim/bike/other: a minimal thumbnail (Total
// distance — total time only when every segment's every rep actually has a
// time recorded, see sumLoggedTimeSeconds — Prescribed total when the log
// fulfills an assignment, and Effort) and a "View splits" dropdown revealing
// each segment's own actual line directly above its prescribed line, paired
// by position. Shown whenever there's any segment data at all, actual or
// target, since the thumbnail itself never breaks down by segment.
function ActualAndPrescribed({ workout, segments }) {
  const loggedSegments = segments || []
  const headline = loggedWorkoutHeadline(workout)

  const assignment = workout.assigned_workouts
  const targetField = ASSIGNED_SEGMENTS_FIELD_BY_TYPE[workout.type]
  const targetSegments = assignment ? assignment[targetField] || [] : []
  const prescribedHeadline = assignment ? assignedWorkoutHeadline(assignment) : []

  const showSplitsToggle = loggedSegments.length > 0 || targetSegments.length > 0
  const rowCount = Math.max(loggedSegments.length, targetSegments.length)

  return (
    <>
      <div className="workout-headline">
        Total: {headline.length > 0 ? headline.join(' @ ') : 'No distance or time recorded'}
      </div>
      {assignment && (
        <div className="workout-headline-prescribed">
          Prescribed: {prescribedHeadline.length > 0 ? prescribedHeadline.join(' @ ') : '—'}
        </div>
      )}
      {workout.perceived_effort && (
        <div className="workout-collapsed-meta">
          <span className="workout-headline-meta">Effort: {workout.perceived_effort}/10</span>
        </div>
      )}

      {showSplitsToggle && (
        <details className="workout-details">
          <summary>View splits</summary>

          <div className="segment-list">
            {Array.from({ length: rowCount }, (_, i) => (
              <SegmentPair key={i} type={workout.type} actualSeg={loggedSegments[i]} targetSeg={targetSegments[i]} />
            ))}
          </div>
        </details>
      )}
    </>
  )
}

// Lifting's equivalent of ActualAndPrescribed: a single exercise has nothing
// to hide behind a toggle (its sets/reps/weight — and target, if assigned —
// fit right in the collapsed summary), so the "View sets" toggle only
// appears once there's more than one exercise logged or assigned.
function LiftingBody({ workout }) {
  const exercises = workout.lifting_exercises || []
  const assignment = workout.assigned_workouts
  const targets = assignment?.assigned_lifting_targets || []
  const singleExercise = exercises.length === 1 ? exercises[0] : null
  const singleTarget = targets.length === 1 ? targets[0] : null
  const showSetsToggle = exercises.length > 1 || targets.length > 1

  return (
    <>
      <div className="workout-stats">
        {singleExercise ? (
          <Stat label={singleExercise.exercise_name} value={liftingExerciseSummary(singleExercise)} />
        ) : (
          <Stat label="Exercises" value={exercises.length} />
        )}
        <Stat label="Effort" value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
      </div>

      {!showSetsToggle && singleTarget && (
        <div className="workout-headline-meta">Prescribed: {liftingTargetSummary(singleTarget)}</div>
      )}

      {showSetsToggle && (
        <details className="workout-details">
          <summary>View sets</summary>
          {exercises.length > 0 && (
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
                {exercises.map((ex) => (
                  <tr key={ex.id}>
                    <td>{ex.exercise_name}</td>
                    <td>{ex.sets ?? '—'}</td>
                    <td>{ex.reps ?? '—'}</td>
                    <td>{ex.weight ? `${ex.weight} lb` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {targets.length > 0 && <TargetVsActual assignment={assignment} workout={workout} />}
        </details>
      )}
    </>
  )
}

function liftingExerciseSummary(ex) {
  return `${ex.sets ?? '—'}×${ex.reps ?? '—'} @ ${ex.weight ? `${ex.weight} lb` : '—'}`
}

export function liftingTargetSummary(t) {
  return `${t.target_sets ?? '—'}×${t.target_reps ?? '—'} @ ${t.target_weight ? `${t.target_weight} lb` : '—'}`
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

// One segment "slot": the athlete's actual line (bold, if this position has
// a logged segment) directly above its prescribed line (muted, if this
// position has a target segment) — paired by position, the same way a
// workout's logged segments are meant to correspond 1:1 to the assignment's
// target segments in the order both were entered. Either line can be
// missing on its own (an unlogged assignment has no actual yet; an
// unassigned log has no prescribed at all).
function SegmentPair({ type, actualSeg, targetSeg }) {
  return (
    <div className="segment-summary">
      {actualSeg && <SegmentLine seg={actualSeg} type={type} kind="actual" />}
      {/* The label is only worth repeating on the prescribed line when
          there's no actual line above it already showing it (e.g. this
          position hasn't been logged yet) — otherwise it's just noise. */}
      {targetSeg && <SegmentLine seg={targetSeg} type={type} kind="target" showLabel={!actualSeg} />}
    </div>
  )
}

// The one shared segment-line formatter for both actual and prescribed,
// running/swim/bike/other — "{label}: {reps}×{distance}{unit} @ {times}",
// the "@ times" part entirely omitted when no time is recorded for any rep
// (never a placeholder), each rep's own time skipped if only that one rep
// is missing (see formatRepTimesList). These four types + two kinds used to
// be eight near-identical, independently-drifting implementations
// (SegmentSummary/SwimSegmentSummary/BikeSegmentSummary/OtherSegmentSummary
// x PrescribedSegmentSummary's per-type branches) — now one function.
export function SegmentLine({ seg, type, kind, showLabel = true }) {
  const isTarget = kind === 'target'
  const reps = seg.reps || 1
  const label = showLabel && seg.label ? `${seg.label}: ` : ''
  const title = `${label}${reps > 1 ? `${reps} × ` : ''}${formatDistanceValue(seg.distance_value, seg.distance_unit)} ${unitAbbrev(seg.distance_unit)}`

  const repsField = isTarget ? ASSIGNED_REPS_FIELD_BY_TYPE[type] : LOGGED_REPS_FIELD_BY_TYPE[type]
  const repRows = repsField ? seg[repsField] || [] : []
  const repSecondsList = repRows.map((r) =>
    isTarget
      ? hmsToSeconds({ hours: r.target_time_hours, minutes: r.target_time_minutes, seconds: r.target_time_seconds })
      : hmsToSeconds({ hours: r.time_hours, minutes: r.time_minutes, seconds: r.time_seconds })
  )
  // A target segment saved before per-rep rows existed has none yet — fall
  // back to its old segment-level target_time_* as a single rep's worth.
  const effectiveSecondsList =
    repRows.length > 0
      ? repSecondsList
      : isTarget
        ? [hmsToSeconds({ hours: seg.target_time_hours, minutes: seg.target_time_minutes, seconds: seg.target_time_seconds })]
        : []

  const timesList = formatRepTimesList(effectiveSecondsList)

  // Bike-only, actuals-only: optional per-rep watts/cadence, appended after
  // the times (or shown on their own if no time was recorded either).
  let extra = ''
  if (!isTarget && type === 'bike') {
    const { avgWatts, avgCadence } = summarizeBikeReps(seg.distance_meters, repRows)
    const parts = []
    if (avgWatts != null) parts.push(`${avgWatts}w avg`)
    if (avgCadence != null) parts.push(`${avgCadence}rpm avg`)
    extra = parts.join(', ')
  }

  const suffix = [timesList, extra].filter(Boolean).join(', ')
  const line = `${isTarget ? 'Prescribed: ' : ''}${title}${suffix ? ` @ ${suffix}` : ''}`

  return <div className={isTarget ? 'segment-summary-detail' : 'segment-summary-title'}>{line}</div>
}
