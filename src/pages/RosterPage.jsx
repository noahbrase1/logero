import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchTeamRoster, removeAthlete } from '../lib/workouts'
import { startDirectConversation } from '../lib/messages'
import { useToast } from '../context/ToastContext'
import StatRow from '../components/StatRow'
import { SkeletonList } from '../components/Skeleton'

export default function RosterPage() {
  const { profile } = useAuth()
  const canManage = profile?.role === 'coach'
  const [athletes, setAthletes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [messagingId, setMessagingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const navigate = useNavigate()
  const { showToast } = useToast()

  useEffect(() => {
    fetchTeamRoster()
      .then(setAthletes)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleMessage(athleteId) {
    setMessagingId(athleteId)
    setError('')
    try {
      const conversationId = await startDirectConversation(athleteId)
      navigate(`/messages/${conversationId}`)
    } catch (err) {
      setError(err.message)
      setMessagingId(null)
    }
  }

  async function handleRemove(athlete) {
    setError('')
    setRemovingId(athlete.id)
    try {
      await removeAthlete(athlete.id)
      setAthletes((prev) => prev.filter((a) => a.id !== athlete.id))
      setConfirmingId(null)
      showToast(`${athlete.name || 'Athlete'} removed from the team`)
    } catch (err) {
      setError(err.message)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Roster</h1>
        <Link to="/former-athletes" className="link-button">
          Former athletes →
        </Link>
      </div>

      {!loading && !error && athletes.length > 0 && (
        <StatRow stats={[{ label: 'On the roster', value: athletes.length }]} />
      )}

      {loading && <SkeletonList count={4} />}
      {error && <p className="form-error">{error}</p>}
      {!loading && !error && athletes.length === 0 && (
        <p className="empty-state">
          No approved athletes yet — approve pending sign-ups to start building your roster.
        </p>
      )}

      <ul className="roster-list">
        {athletes.map((a) => (
          <li key={a.id} className="roster-item">
            <Link to={`/athletes/${a.id}`} className="roster-item-link">
              <span className="roster-name">{a.name || 'Unnamed athlete'}</span>
              {a.role === 'admin' && <span className="type-badge type-admin">Admin</span>}
              <span className="roster-arrow">→</span>
            </Link>
            {canManage && a.role === 'athlete' && (
              <div className="roster-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={messagingId === a.id}
                  onClick={() => handleMessage(a.id)}
                >
                  Message
                </button>
                {confirmingId === a.id ? (
                  <span className="roster-remove-confirm">
                    <span className="form-error">
                      Remove {a.name || 'this athlete'}? This will revoke their access, archive their workout logs,
                      and permanently delete their messages. This cannot be undone.
                    </span>
                    <button
                      type="button"
                      className="danger-solid"
                      disabled={removingId === a.id}
                      onClick={() => handleRemove(a)}
                    >
                      {removingId === a.id ? 'Removing…' : 'Yes, remove'}
                    </button>
                    <button type="button" className="link-button" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="link-button danger" onClick={() => setConfirmingId(a.id)}>
                    Remove
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
