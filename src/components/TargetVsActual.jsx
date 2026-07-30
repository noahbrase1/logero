// `assignment` is an assigned_workouts row (with nested target rows).
// `workout` is the actual logged workout, or omitted if not logged yet.
//
// Lifting only. Running/swim/bike/other used to go through this too, but
// that was replaced by WorkoutCard's own "Prescribed" block (ActualAndPrescribed
// + SegmentLine) — that block's target-vs-actual comparison is now
// genuinely per-rep, which the running/swim/bike branches this file used
// to have never were and would have needed a rewrite to match, for code
// nothing rendered. See WorkoutCard.jsx's LiftingBody for the one
// remaining call site.
export default function TargetVsActual({ assignment, workout }) {
  if (!assignment) return null

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
