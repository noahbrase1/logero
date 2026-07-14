import { useEffect, useState } from 'react'
import { useToast } from '../context/ToastContext'
import { approveTeam, fetchPendingTeams, fetchTeamStats, rejectTeam } from '../lib/teams'
import { SkeletonList } from '../components/Skeleton'
import StatRow from '../components/StatRow'

export default function SuperAdminPage() {
  const { showToast } = useToast()
  const [teams, setTeams] = useState([])
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  function load() {
    setLoading(true)
    setError('')
    Promise.all([fetchTeamStats(), fetchPendingTeams()])
      .then(([stats, pendingTeams]) => {
        setTeams(stats)
        setPending(pendingTeams)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function handleApprove(teamId) {
    setBusyId(teamId)
    setError('')
    try {
      await approveTeam(teamId)
      showToast('Team approved')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(teamId) {
    setBusyId(teamId)
    setError('')
    try {
      await rejectTeam(teamId)
      showToast('Team rejected')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const totals = teams.reduce(
    (acc, t) => ({
      athletes: acc.athletes + Number(t.athlete_count),
      workouts: acc.workouts + Number(t.workout_count),
    }),
    { athletes: 0, workouts: 0 }
  )

  return (
    <div className="page">
      <h1>Super admin</h1>
      <p className="page-subtitle">Review new teams and sanity-check that each one is up and running.</p>

      {error && <p className="form-error">{error}</p>}

      <h2 className="events-section-heading">Pending teams</h2>
      {loading && <SkeletonList count={2} />}
      {!loading && pending.length === 0 && <p className="empty-state">No teams awaiting approval.</p>}
      <div className="assignments-list">
        {pending.map((t) => (
          <div key={t.team_id} className="assignment-row">
            <div>
              <span className="assignment-athlete">{t.team_name}</span>
              <span className="workout-date">created {new Date(t.created_at).toLocaleDateString()}</span>
            </div>
            <div className="assignment-target-summary">
              <span>
                Founder: {t.founder_name || 'Unnamed'} ({t.founder_email || 'no email on file'})
              </span>
            </div>
            <div className="pending-actions">
              <button type="button" disabled={busyId === t.team_id} onClick={() => handleApprove(t.team_id)}>
                Approve
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busyId === t.team_id}
                onClick={() => handleReject(t.team_id)}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      {!loading && !error && teams.length > 0 && (
        <StatRow
          stats={[
            { label: 'Teams', value: teams.length },
            { label: 'Athletes across all teams', value: totals.athletes },
            { label: 'Workouts logged across all teams', value: totals.workouts },
          ]}
        />
      )}

      <h2 className="events-section-heading">All teams</h2>
      {loading && <SkeletonList count={3} />}
      {!loading && !error && teams.length === 0 && <p className="empty-state">No teams yet.</p>}
      <div className="assignments-list">
        {teams.map((t) => (
          <div key={t.team_id} className="assignment-row">
            <div>
              <span className="assignment-athlete">{t.team_name}</span>
              <span className="workout-date">created {new Date(t.created_at).toLocaleDateString()}</span>
            </div>
            <div className="assignment-target-summary">
              <span>
                {t.athlete_count} athlete{Number(t.athlete_count) === 1 ? '' : 's'} · {t.workout_count} workout
                {Number(t.workout_count) === 1 ? '' : 's'} logged
              </span>
            </div>
            <span className={`status-badge status-${t.status}`}>{t.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
