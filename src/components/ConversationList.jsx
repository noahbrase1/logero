import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconEdit, IconSearch, IconSpeakerphone, IconUsers } from '@tabler/icons-react'
import { fetchApprovedAthletes, fetchCoaches } from '../lib/workouts'
import { startDirectConversation } from '../lib/messages'
import { formatConversationTimestamp, getInitials } from '../utils/format'
import { isConversationUnread } from '../utils/conversationReadState'
import GroupCreateForm from './GroupCreateForm'

function conversationName(c) {
  if (c.type === 'team') return 'Team Channel'
  if (c.type === 'direct') return c.directLabel || 'Unnamed user'
  return c.name || 'Group'
}

function conversationPreview(c, viewerId) {
  const lm = c.lastMessage
  if (!lm) return 'No messages yet'
  const text = lm.content || (lm.image_url ? '📷 Photo' : '')
  const isMine = lm.sender_id === viewerId
  if (c.type === 'direct') return isMine ? `You: ${text}` : text
  const senderName = isMine ? 'You' : lm.profiles?.name || 'Someone'
  return `${senderName}: ${text}`
}

// iOS Messages-style conversation list — the sidebar's entire visual
// treatment (avatars, previews, timestamps, unread dots, search, compose
// button), not just a mobile-only variant. Desktop renders it as a
// fixed-width panel beside the conversation pane; below the mobile
// breakpoint it switches to a full-width single-pane list/detail view
// (see the `.mobile-inbox`/`.messages-page-detail` rules in index.css).
export default function ConversationList({ conversations, activeId, viewerId, isCoach, canMessage, onStartedDM, onCreatedGroup }) {
  const [query, setQuery] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [panel, setPanel] = useState(null) // null | 'dm' | 'group'
  const [candidates, setCandidates] = useState([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [error, setError] = useState('')
  const [unreadIds, setUnreadIds] = useState(new Set())

  useEffect(() => {
    const next = new Set()
    for (const c of conversations) {
      if (isConversationUnread(viewerId, c)) next.add(c.id)
    }
    setUnreadIds(next)
  }, [conversations, viewerId])

  async function openDmPicker() {
    setPanel('dm')
    setComposeOpen(false)
    setError('')
    setLoadingCandidates(true)
    try {
      // A coach can message any approved athlete, or any other coach on the
      // team (a solo coach just sees an empty coaches list, so this is a
      // no-op for them). An athlete can still only message a coach.
      let data
      if (isCoach) {
        const [athletes, coaches] = await Promise.all([fetchApprovedAthletes(), fetchCoaches()])
        data = [...athletes, ...coaches.filter((c) => c.id !== viewerId)]
      } else {
        data = await fetchCoaches()
      }
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

  function handleComposeClick() {
    // Athletes only have the one option (message their coach), so skip
    // straight to the picker instead of showing a one-item menu.
    if (!isCoach) {
      openDmPicker()
      return
    }
    setComposeOpen((v) => !v)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => conversationName(c).toLowerCase().includes(q))
  }, [conversations, query])

  return (
    <div className="mobile-inbox">
      <div className="mobile-inbox-header">
        <h1>Messages</h1>
        {canMessage && (
          <div className="mobile-inbox-compose-wrap">
            <button type="button" className="mobile-inbox-compose" onClick={handleComposeClick} aria-label="New message">
              <IconEdit size={20} />
            </button>
            {composeOpen && isCoach && (
              <div className="mobile-inbox-compose-menu">
                <button type="button" onClick={openDmPicker}>
                  New direct message
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPanel('group')
                    setComposeOpen(false)
                  }}
                >
                  New group
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mobile-inbox-search">
        <IconSearch size={16} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search conversations"
        />
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
            <p className="empty-state">{isCoach ? 'No other athletes or coaches to message.' : 'No coach to message.'}</p>
          )}
          <ul className="dm-picker-list">
            {candidates.map((a) => (
              <li key={a.id}>
                <button type="button" className="secondary" onClick={() => handlePick(a.id)}>
                  {a.name || 'Unnamed user'}
                  {a.role === 'coach' && <span className="type-badge type-coach">Coach</span>}
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

      <ul className="mobile-convo-list">
        {filtered.length === 0 && (
          <li className="empty-state">
            {conversations.length === 0 ? 'No conversations yet.' : `No conversations match "${query}".`}
          </li>
        )}
        {filtered.map((c) => {
          const name = conversationName(c)
          const unread = unreadIds.has(c.id)
          return (
            <li key={c.id}>
              <Link
                to={`/messages/${c.id}`}
                className={`mobile-convo-row ${c.id === activeId ? 'mobile-convo-row-active' : ''}`}
              >
                <span className={`mobile-convo-avatar ${c.type === 'team' ? 'mobile-convo-avatar-team' : ''}`}>
                  {c.type === 'team' ? (
                    <IconSpeakerphone size={20} />
                  ) : c.type === 'group' ? (
                    <IconUsers size={20} />
                  ) : (
                    getInitials(name)
                  )}
                </span>
                <span className="mobile-convo-text">
                  <span className="mobile-convo-name">{name}</span>
                  <span className="mobile-convo-preview">{conversationPreview(c, viewerId)}</span>
                </span>
                <span className="mobile-convo-meta">
                  <span className="mobile-convo-time">
                    {c.lastMessage ? formatConversationTimestamp(c.lastMessage.created_at) : ''}
                  </span>
                  {unread && <span className="mobile-convo-unread-dot" aria-label="Unread" />}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
