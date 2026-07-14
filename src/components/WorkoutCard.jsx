import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  calculatePace,
  formatDate,
  secondsToClock,
  summarizeBikeReps,
  summarizeReps,
  unitAbbrev,
  workoutTypeLabel,
} from '../utils/format'
import WorkoutComments from './WorkoutComments'
import TargetVsActual from './TargetVsActual'
import WorkoutTypeIcon from './WorkoutTypeIcon'

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
        <div className="workout-stats">
          <Stat label="Distance" value={workout.total_distance ? `${workout.total_distance} mi` : '—'} />
          <Stat label="Duration" value={workout.total_duration_seconds ? secondsToClock(workout.total_duration_seconds) : '—'} />
          <Stat label="Pace" value={calculatePace(workout.total_distance, workout.total_duration_seconds) || '—'} />
          <Stat label="Effort" value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
        </div>
      ) : isSwim ? (
        <div className="workout-stats">
          <Stat label="Segments" value={workout.swim_segments?.length ?? 0} />
          <Stat label="Effort" value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
        </div>
      ) : isBike ? (
        <div className="workout-stats">
          <Stat label="Segments" value={workout.bike_segments?.length ?? 0} />
          <Stat label="Effort" value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
        </div>
      ) : (
        <div className="workout-stats">
          <Stat label="Exercises" value={workout.lifting_exercises?.length ?? 0} />
          <Stat label="Effort" value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
        </div>
      )}

      {isRunning && workout.running_segments?.length > 0 && (
        <details className="workout-details" open>
          <summary>Segments ({workout.running_segments.length})</summary>
          <div className="segment-list">
            {workout.running_segments.map((seg) => (
              <SegmentSummary key={seg.id} segment={seg} />
            ))}
          </div>
        </details>
      )}

      {isSwim && workout.swim_segments?.length > 0 && (
        <details className="workout-details" open>
          <summary>Segments ({workout.swim_segments.length})</summary>
          <div className="segment-list">
            {workout.swim_segments.map((seg) => (
              <SwimSegmentSummary key={seg.id} segment={seg} />
            ))}
          </div>
        </details>
      )}

      {isBike && workout.bike_segments?.length > 0 && (
        <details className="workout-details" open>
          <summary>Segments ({workout.bike_segments.length})</summary>
          <div className="segment-list">
            {workout.bike_segments.map((seg) => (
              <BikeSegmentSummary key={seg.id} segment={seg} />
            ))}
          </div>
        </details>
      )}

      {isLifting && workout.lifting_exercises?.length > 0 && (
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

      {workout.notes && <p className="workout-notes">{workout.notes}</p>}

      {workout.assigned_workouts && <TargetVsActual assignment={workout.assigned_workouts} workout={workout} />}

      <WorkoutComments workoutId={workout.id} />
    </article>
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
  const title = `${segment.label ? `${segment.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${segment.distance_value} ${unitAbbrev(segment.distance_unit)}`

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
  const title = `${segment.label ? `${segment.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${segment.distance_value} ${unitAbbrev(segment.distance_unit)}`

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
  const title = `${segment.label ? `${segment.label}: ` : ''}${reps > 1 ? `${reps} × ` : ''}${segment.distance_value} ${unitAbbrev(segment.distance_unit)}`

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
