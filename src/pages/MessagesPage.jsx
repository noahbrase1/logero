import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchAllTeamConversations, fetchConversations } from '../lib/messages'
import MessagesSidebar from '../components/MessagesSidebar'
import ConversationView from '../components/ConversationView'

export default function MessagesPage() {
  const { id } = useParams()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile.role === 'admin'

  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadConversations = useCallback(async () => {
    try {
      const data = isAdmin ? await fetchAllTeamConversations(user.id) : await fetchConversations(user.id)
      setConversations(data)
      return data
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

  if (!id) {
    const team = conversations.find((c) => c.type === 'team')
    if (team) return <Navigate to={`/messages/${team.id}`} replace />
  }

  const activeConversation = conversations.find((c) => c.id === id) || null

  return (
    <div className={`messages-page ${activeConversation ? 'messages-page-detail' : ''}`}>
      <MessagesSidebar
        conversations={conversations}
        activeId={id}
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
