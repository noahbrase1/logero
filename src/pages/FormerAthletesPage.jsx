import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchRemovedAthletes, reinstateAthlete } from '../lib/workouts'
import { useToast } from '../context/ToastContext'
import { SkeletonList } from '../components/Skeleton'

export default function FormerAthletesPage() {
  const { profile } = useAuth()
  const canManage = profile?.role === 'coach'
  const { showToast } = useToast()
  const [athletes, setAthletes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [reinstatingId, setReinstatingId] = useState(null)

  useEffect(() => {
    fetchRemovedAthletes()
      .then(setAthletes)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleReinstate(athlete) {
    setError('')
    setReinstatingId(athlete.id)
    try {
      await reinstateAthlete(athlete.id)
      setAthletes((prev) => prev.filter((a) => a.id !== athlete.id))
      setConfirmingId(null)
      showToast(`${athlete.name || 'Athlete'} reinstated`)
    } catch (err) {
      setError(err.message)
    } finally {
      setReinstatingId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1>Former athletes</h1>
          <p className="page-subtitle">Kept for your records — no app access, workout history preserved.</p>
        </div>
        <Link to="/roster" className="link-button">
          ← Back to roster
        </Link>
      </div>

      {loading && <SkeletonList count={4} />}
      {error && <p className="form-error">{error}</p>}
      {!loading && !error && athletes.length === 0 && (
        <p className="empty-state">No former athletes — athletes you remove from the roster will appear here.</p>
      )}

      <ul className="roster-list">
        {athletes.map((a) => (
          <li key={a.id} className="roster-item">
            <Link to={`/athletes/${a.id}`} className="roster-item-link">
              <span className="roster-name">{a.name || 'Unnamed athlete'}</span>
              <span className="roster-arrow">→</span>
            </Link>
            {canManage && (
              <div className="roster-actions">
                {confirmingId === a.id ? (
                  <span className="roster-remove-confirm">
                    <span className="form-info">
                      Reinstate {a.name || 'this athlete'}? They'll regain access, their logs will reappear in the
                      active feed, and they'll be re-added to the team channel. Past messages are not restored.
                    </span>
                    <button type="button" disabled={reinstatingId === a.id} onClick={() => handleReinstate(a)}>
                      {reinstatingId === a.id ? 'Reinstating…' : 'Yes, reinstate'}
                    </button>
                    <button type="button" className="link-button" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="secondary" onClick={() => setConfirmingId(a.id)}>
                    Reinstate
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
