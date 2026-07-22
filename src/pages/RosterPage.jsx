import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  approveProfile,
  fetchPendingProfiles,
  fetchTeamRoster,
  rejectProfile,
  removeAthlete,
} from '../lib/workouts'
import { startDirectConversation } from '../lib/messages'
import { useToast } from '../context/ToastContext'
import StatRow from '../components/StatRow'
import { SkeletonList } from '../components/Skeleton'

// Pending sign-ups are shown above the roster on this same page (coach
// only — admin has no approve/reject ability, so it never fetches or
// renders this section) rather than on their own separate tab.
export default function RosterPage() {
  const { user, profile } = useAuth()
  const canManage = profile?.role === 'coach'
  const [athletes, setAthletes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [messagingId, setMessagingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [pending, setPending] = useState([])
  const [pendingLoading, setPendingLoading] = useState(canManage)
  const [pendingError, setPendingError] = useState('')
  const [busyPendingId, setBusyPendingId] = useState(null)
  const [confirmingRejectId, setConfirmingRejectId] = useState(null)

  useEffect(() => {
    fetchTeamRoster()
      .then(setAthletes)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function loadPending() {
    setPendingLoading(true)
    fetchPendingProfiles()
      .then(setPending)
      .catch((err) => setPendingError(err.message))
      .finally(() => setPendingLoading(false))
  }

  useEffect(() => {
    if (!canManage) return
    loadPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage])

  async function handleApprovePending(profileId, role) {
    setBusyPendingId(profileId)
    setPendingError('')
    try {
      await approveProfile(profileId, role, user.id)
      setPending((prev) => prev.filter((p) => p.id !== profileId))
      showToast(`Approved as ${role}`)
    } catch (err) {
      setPendingError(err.message)
    } finally {
      setBusyPendingId(null)
    }
  }

  async function handleRejectPending(pendingProfile) {
    setBusyPendingId(pendingProfile.id)
    setPendingError('')
    try {
      await rejectProfile(pendingProfile.id)
      setPending((prev) => prev.filter((p) => p.id !== pendingProfile.id))
      setConfirmingRejectId(null)
      showToast(`${pendingProfile.name || 'Sign-up'} rejected`)
    } catch (err) {
      setPendingError(err.message)
    } finally {
      setBusyPendingId(null)
    }
  }

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

      {canManage && (pendingLoading || pendingError || pending.length > 0) && (
        <>
          <h2 className="events-section-heading">Pending sign-ups</h2>
          {pendingLoading && <SkeletonList count={2} />}
          {pendingError && <p className="form-error">{pendingError}</p>}

          {!pendingLoading && !pendingError && pending.length > 0 && (
            <ul className="pending-list">
              {pending.map((p) => (
                <li key={p.id} className="pending-item">
                  <div>
                    <span className="roster-name">{p.name || 'Unnamed user'}</span>
                    <span className="pending-date">signed up {new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
                  {confirmingRejectId === p.id ? (
                    <div className="pending-actions">
                      <span className="form-error">
                        Reject {p.name || 'this sign-up'}? This deletes their account entirely, freeing up their email
                        to sign up again if needed. This cannot be undone.
                      </span>
                      <button
                        type="button"
                        className="danger-solid"
                        disabled={busyPendingId === p.id}
                        onClick={() => handleRejectPending(p)}
                      >
                        {busyPendingId === p.id ? 'Rejecting…' : 'Yes, reject'}
                      </button>
                      <button type="button" className="link-button" onClick={() => setConfirmingRejectId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="pending-actions">
                      <button
                        type="button"
                        disabled={busyPendingId === p.id}
                        onClick={() => handleApprovePending(p.id, 'athlete')}
                      >
                        Approve as Athlete
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busyPendingId === p.id}
                        onClick={() => handleApprovePending(p.id, 'coach')}
                      >
                        Approve as Coach
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busyPendingId === p.id}
                        onClick={() => handleApprovePending(p.id, 'admin')}
                      >
                        Approve as Admin
                      </button>
                      <button
                        type="button"
                        className="link-button danger"
                        disabled={busyPendingId === p.id}
                        onClick={() => setConfirmingRejectId(p.id)}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

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
