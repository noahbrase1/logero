import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { approveProfile, fetchPendingProfiles, rejectProfile } from '../lib/workouts'

export default function PendingApprovalsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [confirmingRejectId, setConfirmingRejectId] = useState(null)

  function load() {
    setLoading(true)
    fetchPendingProfiles()
      .then(setPending)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function handleApprove(profileId, role) {
    setBusyId(profileId)
    setError('')
    try {
      await approveProfile(profileId, role, user.id)
      setPending((prev) => prev.filter((p) => p.id !== profileId))
      showToast(`Approved as ${role}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(profile) {
    setBusyId(profile.id)
    setError('')
    try {
      await rejectProfile(profile.id)
      setPending((prev) => prev.filter((p) => p.id !== profile.id))
      setConfirmingRejectId(null)
      showToast(`${profile.name || 'Sign-up'} rejected`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page">
      <h1>Pending approvals</h1>

      {loading && (
        <div className="loading-state">
          <span className="spinner" /> Loading…
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {!loading && !error && pending.length === 0 && (
        <p className="empty-state">No pending sign-ups right now — new athletes will show up here once they register.</p>
      )}

      <ul className="pending-list">
        {pending.map((p) => (
          <li key={p.id} className="pending-item">
            <div>
              <span className="roster-name">{p.name || 'Unnamed user'}</span>
              <span className="pending-date">
                signed up {new Date(p.created_at).toLocaleDateString()}
              </span>
            </div>
            {confirmingRejectId === p.id ? (
              <div className="pending-actions">
                <span className="form-error">
                  Reject {p.name || 'this sign-up'}? This deletes their account entirely, freeing up their email to
                  sign up again if needed. This cannot be undone.
                </span>
                <button
                  type="button"
                  className="danger-solid"
                  disabled={busyId === p.id}
                  onClick={() => handleReject(p)}
                >
                  {busyId === p.id ? 'Rejecting…' : 'Yes, reject'}
                </button>
                <button type="button" className="link-button" onClick={() => setConfirmingRejectId(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="pending-actions">
                <button
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => handleApprove(p.id, 'athlete')}
                >
                  Approve as Athlete
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busyId === p.id}
                  onClick={() => handleApprove(p.id, 'coach')}
                >
                  Approve as Coach
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busyId === p.id}
                  onClick={() => handleApprove(p.id, 'admin')}
                >
                  Approve as Admin
                </button>
                <button
                  type="button"
                  className="link-button danger"
                  disabled={busyId === p.id}
                  onClick={() => setConfirmingRejectId(p.id)}
                >
                  Reject
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
