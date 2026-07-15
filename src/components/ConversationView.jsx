import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { fetchMessages, sendMessage, subscribeToConversation } from '../lib/messages'
import GroupManageControls from './GroupManageControls'

export default function ConversationView({ conversation, onConversationChanged }) {
  const { user, profile } = useAuth()
  const { showToast } = useToast()
  const isGroupManager = conversation.type === 'group' && profile?.role === 'coach'
  const canSend = profile?.role === 'coach' || profile?.role === 'athlete'
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  const nameFor = (senderId) => {
    if (senderId === user.id) return 'You'
    return conversation.participants.find((p) => p.user_id === senderId)?.profiles?.name || 'Unknown'
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchMessages(conversation.id)
      .then((data) => {
        if (!cancelled) setMessages(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const unsubscribe = subscribeToConversation(conversation.id, (newMessage) => {
      setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [conversation.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e) {
    e.preventDefault()
    const content = draft.trim()
    if (!content) return
    setSending(true)
    setError('')
    try {
      const sent = await sendMessage(conversation.id, user.id, content)
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]))
      setDraft('')
      showToast('Message sent')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="conversation-view">
      <header className="conversation-header">
        <Link to="/messages" className="link-button conversation-back-link">
          ← Back
        </Link>
        <h3>
          {conversation.type === 'team'
            ? 'Team channel'
            : conversation.type === 'group'
              ? conversation.name || 'Group'
              : conversation.directLabel || conversation.otherParticipant?.name || 'Direct message'}
        </h3>
        {isGroupManager && <GroupManageControls conversation={conversation} onChanged={onConversationChanged} />}
      </header>

      <div className="message-list">
        {loading && (
          <div className="loading-state">
            <span className="spinner" /> Loading messages…
          </div>
        )}
        {!loading && messages.length === 0 && <p className="empty-state">No messages yet. Say hello!</p>}
        {messages.map((m) => (
          <div key={m.id} className={`message-bubble ${m.sender_id === user.id ? 'own' : ''}`}>
            <div className="message-meta">
              <span className="message-sender">{m.profiles?.name || nameFor(m.sender_id)}</span>
              <span className="message-time">
                {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
            <div className="message-content">{m.content}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <p className="form-error">{error}</p>}

      {canSend ? (
        <form className="message-input-row" onSubmit={handleSend}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message…"
          />
          <button type="submit" disabled={sending || !draft.trim()}>
            Send
          </button>
        </form>
      ) : (
        <p className="empty-state">Admins have read-only access to messages.</p>
      )}
    </section>
  )
}
