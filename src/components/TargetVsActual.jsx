import {
  formatTargetPace,
  hmsToSeconds,
  secondsToClock,
  summarizeBikeReps,
  summarizeReps,
  unitAbbrev,
} from '../utils/format'

// `assignment` is an assigned_workouts row (with nested target rows).
// `workout` is the actual logged workout, or omitted if not logged yet.
export default function TargetVsActual({ assignment, workout }) {
  if (!assignment) return null

  if (assignment.type === 'running') {
    const targetSegments = assignment.assigned_running_segments || []
    if (targetSegments.length === 0) return null

    const actualSegments = workout?.running_segments || []

    return (
      <div className="target-actual">
        <div className="target-actual-heading">Target vs. actual</div>
        {targetSegments.map((seg, i) => {
          const title = `${seg.label ? `${seg.label} — ` : ''}${seg.reps > 1 ? `${seg.reps} × ` : ''}${seg.distance_value} ${unitAbbrev(seg.distance_unit)}`
          const targetSeconds = hmsToSeconds({
            hours: seg.target_time_hours,
            minutes: seg.target_time_minutes,
            seconds: seg.target_time_seconds,
          })
          const targetPace = formatTargetPace(seg.distance_value, seg.distance_unit, seg.reps, targetSeconds)
          const actualSegment = actualSegments[i]
          const actualSummary = actualSegment
            ? summarizeReps(actualSegment.distance_meters, actualSegment.running_segment_reps)
            : null

          return (
            <div className="target-actual-segment" key={seg.id}>
              <div className="target-actual-segment-title">{title}</div>
              <div className="target-actual-row">
                <span className="ta-label">Target</span>
                <span>{targetPace || '—'}</span>
              </div>
              <div className="target-actual-row">
                <span className="ta-label">Actual</span>
                <span>
                  {actualSummary
                    ? `${actualSummary.timesText}${actualSummary.avgPace ? ` — avg pace ${actualSummary.avgPace}` : ''}`
                    : 'Not yet logged'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (assignment.type === 'swim') {
    const targetSegments = assignment.assigned_swim_segments || []
    if (targetSegments.length === 0) return null

    const actualSegments = workout?.swim_segments || []

    return (
      <div className="target-actual">
        <div className="target-actual-heading">Target vs. actual</div>
        {targetSegments.map((seg, i) => {
          const title = `${seg.label ? `${seg.label} — ` : ''}${seg.reps > 1 ? `${seg.reps} × ` : ''}${seg.distance_value} ${unitAbbrev(seg.distance_unit)}`
          const targetSeconds = hmsToSeconds({
            hours: seg.target_time_hours,
            minutes: seg.target_time_minutes,
            seconds: seg.target_time_seconds,
          })
          const actualSegment = actualSegments[i]
          const actualSummary = actualSegment
            ? summarizeReps(actualSegment.distance_meters, actualSegment.swim_segment_reps)
            : null

          return (
            <div className="target-actual-segment" key={seg.id}>
              <div className="target-actual-segment-title">{title}</div>
              <div className="target-actual-row">
                <span className="ta-label">Target</span>
                <span>{targetSeconds > 0 ? `${secondsToClock(targetSeconds)}${seg.reps > 1 ? ' per rep' : ''}` : '—'}</span>
              </div>
              <div className="target-actual-row">
                <span className="ta-label">Actual</span>
                <span>{actualSummary ? actualSummary.timesText : 'Not yet logged'}</span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (assignment.type === 'bike') {
    const targetSegments = assignment.assigned_bike_segments || []
    if (targetSegments.length === 0) return null

    const actualSegments = workout?.bike_segments || []

    return (
      <div className="target-actual">
        <div className="target-actual-heading">Target vs. actual</div>
        {targetSegments.map((seg, i) => {
          const title = `${seg.label ? `${seg.label} — ` : ''}${seg.reps > 1 ? `${seg.reps} × ` : ''}${seg.distance_value} ${unitAbbrev(seg.distance_unit)}`
          const targetSeconds = hmsToSeconds({
            hours: seg.target_time_hours,
            minutes: seg.target_time_minutes,
            seconds: seg.target_time_seconds,
          })
          const actualSegment = actualSegments[i]
          const actualSummary = actualSegment
            ? summarizeBikeReps(actualSegment.distance_meters, actualSegment.bike_segment_reps)
            : null
          const actualExtras = []
          if (actualSummary?.avgWatts != null) actualExtras.push(`${actualSummary.avgWatts}w avg`)
          if (actualSummary?.avgCadence != null) actualExtras.push(`${actualSummary.avgCadence}rpm avg`)

          return (
            <div className="target-actual-segment" key={seg.id}>
              <div className="target-actual-segment-title">{title}</div>
              <div className="target-actual-row">
                <span className="ta-label">Target</span>
                <span>{targetSeconds > 0 ? `${secondsToClock(targetSeconds)}${seg.reps > 1 ? ' per rep' : ''}` : '—'}</span>
              </div>
              <div className="target-actual-row">
                <span className="ta-label">Actual</span>
                <span>
                  {actualSummary
                    ? `${actualSummary.timesText}${actualExtras.length > 0 ? `, ${actualExtras.join(', ')}` : ''}`
                    : 'Not yet logged'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const targets = assignment.assigned_lifting_targets || []
  if (targets.length === 0) return null

  const actualByName = new Map(
    (workout?.lifting_exercises || []).map((ex) => [ex.exercise_name.trim().toLowerCase(), ex])
  )

  return (
    <div className="target-actual">
      <div className="target-actual-heading">Target vs. actual</div>
      <table className="detail-table">
        <thead>
          <tr>
            <th>Exercise</th>
            <th>Target</th>
            <th>Actual</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const actual = actualByName.get(t.exercise_name.trim().toLowerCase())
            return (
              <tr key={t.id}>
                <td>{t.exercise_name}</td>
                <td>
                  {t.target_sets ?? '—'}×{t.target_reps ?? '—'} @ {t.target_weight ? `${t.target_weight} lb` : '—'}
                </td>
                <td>
                  {actual ? `${actual.sets ?? '—'}×${actual.reps ?? '—'} @ ${actual.weight ? `${actual.weight} lb` : '—'}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
