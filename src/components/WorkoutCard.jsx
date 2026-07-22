import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
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

// assigned_workouts' target-segments field, per workout type — running/swim/
// bike only (lifting keeps its existing TargetVsActual comparison instead,
// see the isLifting branch below).
const ASSIGNED_SEGMENTS_FIELD_BY_TYPE = {
  running: 'assigned_running_segments',
  swim: 'assigned_swim_segments',
  bike: 'assigned_bike_segments',
}

export default function WorkoutCard({ workout, showAthleteName = false }) {
  const { user, profile } = useAuth()
  const isRunning = workout.type === 'running'
  const isSwim = workout.type === 'swim'
  const isBike = workout.type === 'bike'
  const isLifting = workout.type === 'lifting'
  const canEdit = profile?.role === 'athlete' && user?.id === workout.user_id

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
        <ActualAndPrescribed workout={workout} segments={workout.running_segments} SegmentComponent={SegmentSummary} />
      ) : isSwim ? (
        <ActualAndPrescribed workout={workout} segments={workout.swim_segments} SegmentComponent={SwimSegmentSummary} />
      ) : isBike ? (
        <ActualAndPrescribed workout={workout} segments={workout.bike_segments} SegmentComponent={BikeSegmentSummary} />
      ) : (
        <>
          <div className="workout-stats">
            <Stat label="Exercises" value={workout.lifting_exercises?.length ?? 0} />
            <Stat label="Effort" value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
          </div>

          {workout.lifting_exercises?.length > 0 && (
            <details className="workout-details">
              <summary>Exercises ({workout.lifting_exercises.length})</summary>
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
                  {workout.lifting_exercises.map((ex) => (
                    <tr key={ex.id}>
                      <td>{ex.exercise_name}</td>
                      <td>{ex.sets ?? '—'}</td>
                      <td>{ex.reps ?? '—'}</td>
                      <td>{ex.weight ? `${ex.weight} lb` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      {workout.notes && <p className="workout-notes">{workout.notes}</p>}

      {isLifting && workout.assigned_workouts && <TargetVsActual assignment={workout.assigned_workouts} workout={workout} />}

      <WorkoutComments workoutId={workout.id} />
    </article>
  )
}

// Shared body for running/swim/bike: a bold top-line headline of what the
// athlete actually did (distance, time, average pace where meaningful),
// their recorded splits below it in smaller type, and — only when this log
// fulfills an assignment — the coach's prescribed workout directly below
// that, in the same two-tier shape (headline, then splits), rather than a
// per-segment target-vs-actual comparison.
function ActualAndPrescribed({ workout, segments, SegmentComponent }) {
  const loggedSegments = segments || []
  const headline = loggedWorkoutHeadline(workout)

  const assignment = workout.assigned_workouts
  const targetField = ASSIGNED_SEGMENTS_FIELD_BY_TYPE[workout.type]
  const targetSegments = assignment ? assignment[targetField] || [] : []
  const prescribedHeadline = assignment ? assignedWorkoutHeadline(assignment) : []

  return (
    <>
      <div className="workout-headline">
        {headline.length > 0 ? headline.join(' · ') : 'No distance or time recorded'}
      </div>
      {workout.perceived_effort && <div className="workout-headline-meta">Effort {workout.perceived_effort}/10</div>}

      {loggedSegments.length > 0 && (
        <div className="segment-list">
          {loggedSegments.map((seg) => (
            <SegmentComponent key={seg.id} segment={seg} />
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
            {targetSegments.map((seg) => (
              <PrescribedSegmentSummary key={seg.id} seg={seg} type={workout.type} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function SegmentSummary({ segment }) {
  const reps = segment.reps || 1
  const { timesText, avgPace } = summarizeReps(segment.distance_meters, segment.running_segment_reps)
  const title = `${segment.label ? `${segment.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${formatDistanceValue(segment.distance_value, segment.distance_unit)} ${unitAbbrev(segment.distance_unit)}`

  return (
    <div className="segment-summary">
      <div className="segment-summary-title">{title}</div>
      <div className="segment-summary-detail">
        {timesText}
        {avgPace && <span className="segment-summary-pace"> — avg pace {avgPace}</span>}
      </div>
    </div>
  )
}

// No pace shown — unlike running, swim pace isn't a meaningful summary stat
// in this app, so the segment summary is just its times (e.g. "100m
// freestyle x4 — 1:15, 1:17, 1:14, 1:16").
function SwimSegmentSummary({ segment }) {
  const reps = segment.reps || 1
  const { timesText } = summarizeReps(segment.distance_meters, segment.swim_segment_reps)
  const title = `${segment.label ? `${segment.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${formatDistanceValue(segment.distance_value, segment.distance_unit)} ${unitAbbrev(segment.distance_unit)}`

  return (
    <div className="segment-summary">
      <div className="segment-summary-title">{title}</div>
      <div className="segment-summary-detail">{timesText}</div>
    </div>
  )
}

// Watts/cadence are appended after the times only when present — an athlete
// without a power meter/cadence sensor just sees times, exactly like swim
// (e.g. "10 miles — 28:40, 245w avg, 88rpm avg").
function BikeSegmentSummary({ segment }) {
  const reps = segment.reps || 1
  const { timesText, avgWatts, avgCadence } = summarizeBikeReps(segment.distance_meters, segment.bike_segment_reps)
  const title = `${segment.label ? `${segment.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${formatDistanceValue(segment.distance_value, segment.distance_unit)} ${unitAbbrev(segment.distance_unit)}`

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

// The coach's target for one segment — same title shape as the actual
// SegmentSummary components above (label + reps× + distance+unit), so
// actual and prescribed splits read as visually parallel lists. Running
// gets a pace (formatTargetPace already picks continuous-vs-interval
// phrasing); swim/bike show the raw target time instead, same as
// TargetVsActual's existing swim/bike target rows.
function PrescribedSegmentSummary({ seg, type }) {
  const reps = seg.reps || 1
  const targetSeconds = hmsToSeconds({
    hours: seg.target_time_hours,
    minutes: seg.target_time_minutes,
    seconds: seg.target_time_seconds,
  })
  const title = `${seg.label ? `${seg.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${formatDistanceValue(seg.distance_value, seg.distance_unit)} ${unitAbbrev(seg.distance_unit)}`
  const detail =
    type === 'running'
      ? formatTargetPace(seg.distance_value, seg.distance_unit, reps, targetSeconds)
      : targetSeconds > 0
        ? `${secondsToClock(targetSeconds)}${reps > 1 ? '/rep' : ''}`
        : null

  return (
    <div className="segment-summary">
      <div className="segment-summary-title">{title}</div>
      <div className="segment-summary-detail">{detail || '—'}</div>
    </div>
  )
}
