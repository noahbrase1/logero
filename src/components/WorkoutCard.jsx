import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  ASSIGNED_REPS_FIELD_BY_TYPE,
  ASSIGNED_SEGMENTS_FIELD_BY_TYPE,
  LOGGED_REPS_FIELD_BY_TYPE,
  assignedDistanceSummary,
  assignedWorkoutHeadline,
  formatDate,
  formatDistanceValue,
  formatTargetPace,
  hmsToSeconds,
  loggedWorkoutHeadline,
  secondsToClock,
  summarizeBikeReps,
  summarizeReps,
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

// Shared body for running/swim/bike/other: a bold top-line headline of what
// the athlete actually did (distance, time, average pace where meaningful),
// a compact "Prescribed: <distance>" line when this log fulfills an
// assignment, and — only when there's genuine segment detail worth
// revealing (more than one segment, or a segment with more than one rep) —
// a "View splits" toggle exposing the full segment breakdown plus the
// coach's prescribed workout, same shape as before this toggle existed.
// A single-segment, single-rep workout has nothing left to reveal once its
// total is already the headline, so no toggle is shown for it at all.
function ActualAndPrescribed({ workout, segments }) {
  const loggedSegments = segments || []
  const headline = loggedWorkoutHeadline(workout)

  const assignment = workout.assigned_workouts
  const targetField = ASSIGNED_SEGMENTS_FIELD_BY_TYPE[workout.type]
  const targetSegments = assignment ? assignment[targetField] || [] : []
  const prescribedHeadline = assignment ? assignedWorkoutHeadline(assignment) : []
  const prescribedDistance = assignment ? assignedDistanceSummary(assignment) : null

  const hasSplitDetail = (segs) => segs.length > 1 || segs.some((seg) => (seg.reps || 1) > 1)
  const showSplitsToggle = hasSplitDetail(loggedSegments) || hasSplitDetail(targetSegments)

  return (
    <>
      <div className="workout-headline">
        {headline.length > 0 ? headline.join(' · ') : 'No distance or time recorded'}
      </div>
      {(workout.perceived_effort || prescribedDistance) && (
        <div className="workout-collapsed-meta">
          {workout.perceived_effort && <span className="workout-headline-meta">Effort {workout.perceived_effort}/10</span>}
          {prescribedDistance && (
            <span className="workout-headline-meta">
              Prescribed: {formatDistanceValue(prescribedDistance.value, prescribedDistance.unit)}
              {unitAbbrev(prescribedDistance.unit)}
            </span>
          )}
        </div>
      )}

      {showSplitsToggle && (
        <details className="workout-details">
          <summary>View splits</summary>

          {loggedSegments.length > 0 && (
            <div className="segment-list">
              {loggedSegments.map((seg) => (
                <SegmentSummary key={seg.id} segment={seg} type={workout.type} />
              ))}
            </div>
          )}

          {targetSegments.length > 0 && (
            <div className="target-actual">
              <div className="target-actual-heading">Prescribed</div>
              <div className="workout-headline workout-headline-prescribed">
                {prescribedHeadline.length > 0 ? prescribedHeadline.join(' · ') : '—'}
              </div>
              <div className="segment-list">
                {targetSegments.map((seg, i) => (
                  <PrescribedSegmentSummary
                    key={seg.id}
                    seg={seg}
                    type={workout.type}
                    // Matched by position, same as the grid/list assignment
                    // UI's own segment ordering — a workout's logged
                    // segments are meant to correspond 1:1 to the
                    // assignment's target segments in the order they were
                    // both entered.
                    actualSegment={loggedSegments[i]}
                  />
                ))}
              </div>
            </div>
          )}
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

// The one shared "actual segment" summary for running/swim/bike/other —
// these four had drifted into separate near-identical components that
// differed only in two respects: only running shows a pace (swim/bike/other
// don't have a single meaningful pace-like figure — see BikeSegmentSummary's
// old comment on why bike shows watts/cadence instead, and the analogous
// reasoning for swim/other), and only bike has optional per-rep watts/
// cadence extras. Consolidated into one function parameterized by `type`
// rather than four copies that could each drift independently.
function SegmentSummary({ segment, type }) {
  const reps = segment.reps || 1
  const repsField = LOGGED_REPS_FIELD_BY_TYPE[type]
  const title = `${segment.label ? `${segment.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${formatDistanceValue(segment.distance_value, segment.distance_unit)} ${unitAbbrev(segment.distance_unit)}`

  if (type === 'bike') {
    const { timesText, avgWatts, avgCadence } = summarizeBikeReps(segment.distance_meters, segment[repsField])
    const extras = []
    if (avgWatts != null) extras.push(`${avgWatts}w avg`)
    if (avgCadence != null) extras.push(`${avgCadence}rpm avg`)
    return (
      <div className="segment-summary">
        <div className="segment-summary-title">{title}</div>
        <div className="segment-summary-detail">
          {timesText}
          {extras.length > 0 && `, ${extras.join(', ')}`}
        </div>
      </div>
    )
  }

  const { timesText, avgPace } = summarizeReps(segment.distance_meters, segment[repsField])

  return (
    <div className="segment-summary">
      <div className="segment-summary-title">{title}</div>
      <div className="segment-summary-detail">
        {timesText}
        {type === 'running' && avgPace && <span className="segment-summary-pace"> — avg pace {avgPace}</span>}
      </div>
    </div>
  )
}

// The coach's target for one segment — same title shape as the actual
// SegmentSummary components above (label + reps× + distance+unit), so
// actual and prescribed splits read as visually parallel lists. Each rep
// gets its own target time row (running/swim/bike; see
// assigned_running_segment_reps etc.) rather than one shared value for the
// whole segment. When `actualSegment` is given (the logged segment at the
// same position, if this log fulfills the assignment), each target rep is
// paired with its own corresponding actual rep — rep 1 target vs rep 1
// actual, rep 2 vs rep 2, and so on — instead of comparing against the
// segment as a whole.
export function PrescribedSegmentSummary({ seg, type, actualSegment }) {
  const reps = seg.reps || 1
  const title = `${seg.label ? `${seg.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${formatDistanceValue(seg.distance_value, seg.distance_unit)} ${unitAbbrev(seg.distance_unit)}`

  const targetRepsField = ASSIGNED_REPS_FIELD_BY_TYPE[type]
  const targetRepRows = targetRepsField ? seg[targetRepsField] || [] : []
  // A segment saved before per-rep target rows existed has none yet — fall
  // back to its old segment-level target_time_* as a single "rep 1" row so
  // it still renders a target instead of nothing.
  const effectiveTargetReps =
    targetRepRows.length > 0
      ? targetRepRows
      : [{ target_time_hours: seg.target_time_hours, target_time_minutes: seg.target_time_minutes, target_time_seconds: seg.target_time_seconds }]

  const actualRepsField = LOGGED_REPS_FIELD_BY_TYPE[type]
  const actualRepRows = actualSegment && actualRepsField ? actualSegment[actualRepsField] || [] : null

  function targetDetailFor(targetRow) {
    const targetSeconds = hmsToSeconds({
      hours: targetRow.target_time_hours,
      minutes: targetRow.target_time_minutes,
      seconds: targetRow.target_time_seconds,
    })
    if (type === 'running') return formatTargetPace(seg.distance_value, seg.distance_unit, reps, targetSeconds)
    return targetSeconds > 0 ? secondsToClock(targetSeconds) : null
  }

  return (
    <div className="segment-summary">
      <div className="segment-summary-title">{title}</div>
      {effectiveTargetReps.map((targetRow, i) => {
        const targetDetail = targetDetailFor(targetRow) || '—'
        const repLabel = reps > 1 ? `Rep ${i + 1}: ` : ''

        if (!actualRepRows) {
          return (
            <div className="segment-summary-detail" key={i}>
              {repLabel}
              {targetDetail}
            </div>
          )
        }

        const actualRow = actualRepRows[i]
        const actualSeconds = actualRow
          ? hmsToSeconds({ hours: actualRow.time_hours, minutes: actualRow.time_minutes, seconds: actualRow.time_seconds })
          : 0
        const actualDetail = actualSeconds > 0 ? secondsToClock(actualSeconds) : 'not yet logged'

        return (
          <div className="segment-summary-detail" key={i}>
            {repLabel}
            Target {targetDetail} · Actual {actualDetail}
          </div>
        )
      })}
    </div>
  )
}
