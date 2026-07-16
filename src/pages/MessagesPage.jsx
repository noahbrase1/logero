import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchAllTeamConversations, fetchConversations, fetchLastMessagesForConversations } from '../lib/messages'
import ConversationList from '../components/ConversationList'
import ConversationView from '../components/ConversationView'

// Team channel always first, then most-recent-activity first — a
// conversation with no messages yet falls back to its own created_at so it
// still slots in somewhere sensible relative to other empty conversations
// rather than jumping around.
function sortByRecency(conversations) {
  return [...conversations].sort((a, b) => {
    if (a.type === 'team') return -1
    if (b.type === 'team') return 1
    const aTime = a.lastMessage?.created_at || a.created_at
    const bTime = b.lastMessage?.created_at || b.created_at
    return new Date(bTime) - new Date(aTime)
  })
}

export default function MessagesPage() {
  const { id } = useParams()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const showingList = searchParams.get('view') === 'list'
  const isAdmin = profile.role === 'admin'

  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadConversations = useCallback(async () => {
    try {
      const data = isAdmin ? await fetchAllTeamConversations(user.id) : await fetchConversations(user.id)
      const lastMessages = await fetchLastMessagesForConversations(data.map((c) => c.id))
      const withPreviews = sortByRecency(data.map((c) => ({ ...c, lastMessage: lastMessages[c.id] || null })))
      setConversations(withPreviews)
      return withPreviews
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [user.id, isAdmin])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  async function handleStartedDM(conversationId) {
    await loadConversations()
    navigate(`/messages/${conversationId}`)
  }

  async function handleCreatedGroup(conversationId) {
    await loadConversations()
    navigate(`/messages/${conversationId}`)
  }

  async function handleGroupChanged() {
    const data = await loadConversations()
    if (id && !data.some((c) => c.id === id)) {
      // The active group was deleted out from under us.
      navigate('/messages', { replace: true })
    }
  }

  if (loading) {
    return (
      <div className="page loading-state">
        <span className="spinner" /> Loading messages…
      </div>
    )
  }
  if (error) return <div className="page form-error">{error}</div>

  // Jumping straight into the team channel is a nice default on first load,
  // but it must not override an explicit request to see the chat list —
  // otherwise, on the single-pane mobile layout, tapping "Back" out of a
  // conversation would just bounce straight back into the same one (there's
  // always a team channel to redirect to), leaving no way to reach the
  // DM/Group picker or switch to a different conversation.
  if (!id && !showingList) {
    const team = conversations.find((c) => c.type === 'team')
    if (team) return <Navigate to={`/messages/${team.id}`} replace />
  }

  const activeConversation = conversations.find((c) => c.id === id) || null

  return (
    <div className={`messages-page ${activeConversation ? 'messages-page-detail' : ''}`}>
      <ConversationList
        conversations={conversations}
        activeId={id}
        viewerId={user.id}
        isCoach={profile.role === 'coach'}
        canMessage={!isAdmin}
        onStartedDM={handleStartedDM}
        onCreatedGroup={handleCreatedGroup}
      />
      {activeConversation ? (
        <ConversationView
          key={activeConversation.id}
          conversation={activeConversation}
          onConversationChanged={handleGroupChanged}
        />
      ) : (
        <div className="conversation-empty">
          {conversations.length === 0 ? 'No conversations yet.' : 'Select a conversation'}
        </div>
      )}
    </div>
  )
}
