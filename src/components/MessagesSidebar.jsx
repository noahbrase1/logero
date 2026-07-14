import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchApprovedAthletes, fetchCoaches } from '../lib/workouts'
import { startDirectConversation } from '../lib/messages'
import GroupCreateForm from './GroupCreateForm'

export default function MessagesSidebar({ conversations, activeId, isCoach, canMessage = true, onStartedDM, onCreatedGroup }) {
  const [panel, setPanel] = useState(null) // null | 'dm' | 'group'
  const [candidates, setCandidates] = useState([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [error, setError] = useState('')

  async function openDmPicker() {
    setPanel('dm')
    setError('')
    setLoadingCandidates(true)
    try {
      const data = isCoach ? await fetchApprovedAthletes() : await fetchCoaches()
      const existingDmUserIds = new Set(
        conversations.filter((c) => c.type === 'direct').map((c) => c.otherParticipant?.id)
      )
      setCandidates(data.filter((a) => !existingDmUserIds.has(a.id)))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingCandidates(false)
    }
  }

  async function handlePick(userId) {
    setError('')
    try {
      const conversationId = await startDirectConversation(userId)
      setPanel(null)
      await onStartedDM(conversationId)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleGroupCreated(conversationId) {
    setPanel(null)
    await onCreatedGroup(conversationId)
  }

  const teamAndGroups = conversations.filter((c) => c.type === 'team' || c.type === 'group')
  const directs = conversations.filter((c) => c.type === 'direct')

  return (
    <aside className="messages-sidebar">
      <div className="messages-sidebar-header">
        <h2>Messages</h2>
        {canMessage && (
          <div className="messages-sidebar-actions">
            <button type="button" className="secondary messages-sidebar-btn" onClick={openDmPicker}>
              + New DM
            </button>
            {isCoach && (
              <button type="button" className="secondary messages-sidebar-btn" onClick={() => setPanel('group')}>
                + New Group
              </button>
            )}
          </div>
        )}
      </div>

      {panel === 'dm' && (
        <div className="dm-picker">
          <div className="dm-picker-title">Start a conversation with…</div>
          {loadingCandidates && (
            <div className="loading-state">
              <span className="spinner" /> Loading…
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          {!loadingCandidates && candidates.length === 0 && !error && (
            <p className="empty-state">{isCoach ? 'No other approved athletes to message.' : 'No coach to message.'}</p>
          )}
          <ul className="dm-picker-list">
            {candidates.map((a) => (
              <li key={a.id}>
                <button type="button" className="secondary" onClick={() => handlePick(a.id)}>
                  {a.name || 'Unnamed user'}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" onClick={() => setPanel(null)}>
            Cancel
          </button>
        </div>
      )}

      {panel === 'group' && <GroupCreateForm onCreated={handleGroupCreated} onCancel={() => setPanel(null)} />}

      <ul className="conversation-list">
        {teamAndGroups.map((c) => (
          <li key={c.id}>
            <Link to={`/messages/${c.id}`} className={`conversation-item ${c.id === activeId ? 'active' : ''}`}>
              {c.type === 'team' ? (
                <span className="conversation-name">📣 Team channel</span>
              ) : (
                <span className="conversation-name">👥 {c.name || 'Group'}</span>
              )}
            </Link>
          </li>
        ))}
        {directs.map((c) => (
          <li key={c.id}>
            <Link to={`/messages/${c.id}`} className={`conversation-item ${c.id === activeId ? 'active' : ''}`}>
              <span className="conversation-name">{c.directLabel || 'Unnamed user'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  )
}
