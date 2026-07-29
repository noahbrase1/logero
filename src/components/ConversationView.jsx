import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconPhoto, IconX } from '@tabler/icons-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  fetchMessages,
  resolveMessageImageUrls,
  sendMessage,
  subscribeToConversation,
  uploadMessageImage,
} from '../lib/messages'
import { markConversationSeen } from '../utils/conversationReadState'
import { onAppResume } from '../utils/appResume'
import { withTimeout } from '../utils/withTimeout'
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
  const [imageFile, setImageFile] = useState(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null)
  const [imageUrls, setImageUrls] = useState({})
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)
  // Shared between loadMessages and the effect's cleanup — reset to false
  // each time the effect (re-)runs, so a Retry-button click (or a resume
  // firing after cleanup already ran) never writes state into an unmounted
  // component.
  const cancelledRef = useRef(false)

  const nameFor = (senderId) => {
    if (senderId === user.id) return 'You'
    return conversation.participants.find((p) => p.user_id === senderId)?.profiles?.name || 'Unknown'
  }

  // A timeout wrapper so a dead connection (most commonly: this tab was
  // backgrounded/suspended for a while and the request never actually
  // settles once resumed) shows a retryable error instead of hanging the
  // spinner forever — see src/utils/withTimeout.js. Also reused directly by
  // the "Retry" button below and by the resume-recovery effect.
  const loadMessages = useCallback(() => {
    setLoading(true)
    setError('')
    withTimeout(fetchMessages(conversation.id), 9000)
      .then((data) => {
        if (!cancelledRef.current) {
          setMessages(data)
          const last = data[data.length - 1]
          markConversationSeen(user.id, conversation.id, last ? last.created_at : new Date().toISOString())
        }
      })
      .catch((err) => {
        if (!cancelledRef.current) setError(err.message)
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false)
      })
  }, [conversation.id, user.id])

  useEffect(() => {
    cancelledRef.current = false
    loadMessages()

    function handleRealtimeInsert(newMessage) {
      setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]))
      markConversationSeen(user.id, conversation.id, newMessage.created_at)
    }

    let unsubscribe = subscribeToConversation(conversation.id, handleRealtimeInsert)

    // A phone backgrounding this tab for a while can silently kill both the
    // realtime websocket and any in-flight fetch without the app ever
    // seeing a clean close/error event — resuming re-fetches the message
    // list (in case anything arrived while disconnected) and tears down +
    // recreates the realtime subscription outright, rather than trusting a
    // channel that may be a dead connection wearing a "subscribed" label.
    const stopResumeListener = onAppResume(() => {
      loadMessages()
      unsubscribe()
      unsubscribe = subscribeToConversation(conversation.id, handleRealtimeInsert)
    })

    return () => {
      cancelledRef.current = true
      unsubscribe()
      stopResumeListener()
    }
  }, [conversation.id, loadMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Resolves signed URLs for any message's image_url not already resolved —
  // covers the initial fetchMessages load, realtime-inserted messages, and
  // the locally-appended just-sent message uniformly, since they all flow
  // through this same `messages` array.
  useEffect(() => {
    const pending = messages.map((m) => m.image_url).filter((path) => path && !imageUrls[path])
    if (pending.length === 0) return
    let cancelled = false
    resolveMessageImageUrls(pending)
      .then((urls) => {
        if (!cancelled) setImageUrls((prev) => ({ ...prev, ...urls }))
      })
      .catch(() => {}) // best-effort — a failed resolve just leaves that one image showing its loading state
    return () => {
      cancelled = true
    }
  }, [messages, imageUrls])

  // Revoke the preview's object URL whenever it's replaced or the component
  // unmounts, so selecting several images in a row doesn't leak memory.
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    }
  }, [imagePreviewUrl])

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file later
    if (!file) return

    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
      setError('That file type isn\'t supported. Please choose a JPEG, PNG, WebP, or GIF image.')
      return
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setError('That image is too large — please choose one under 10MB.')
      return
    }

    setError('')
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImageFile(file)
    setImagePreviewUrl(URL.createObjectURL(file))
  }

  function removeSelectedImage() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImageFile(null)
    setImagePreviewUrl(null)
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = draft.trim()
    if (!content && !imageFile) return
    setSending(true)
    setError('')
    try {
      const imagePath = imageFile ? await uploadMessageImage(profile.team_id, conversation.id, imageFile) : null
      const sent = await sendMessage(conversation.id, user.id, content || null, imagePath)
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]))
      setDraft('')
      removeSelectedImage()
      showToast('Message sent')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <section className="conversation-view">
        <header className="conversation-header">
          <Link to="/messages?view=list" className="link-button conversation-back-link">
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
              {m.image_url &&
                (imageUrls[m.image_url] ? (
                  <img
                    src={imageUrls[m.image_url]}
                    alt="Shared attachment"
                    className="message-image"
                    onClick={() => setLightboxUrl(imageUrls[m.image_url])}
                  />
                ) : (
                  <div className="message-image message-image-loading">
                    <span className="spinner" />
                  </div>
                ))}
              {m.content && <div className="message-content">{m.content}</div>}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="form-error">
            {error}{' '}
            <button type="button" className="link-button" onClick={loadMessages}>
              Retry
            </button>
          </p>
        )}

        {canSend ? (
          <form className="message-input-row" onSubmit={handleSend}>
            {imagePreviewUrl && (
              <div className="message-image-preview">
                <img src={imagePreviewUrl} alt="Selected attachment preview" />
                <button
                  type="button"
                  className="message-image-preview-remove"
                  onClick={removeSelectedImage}
                  aria-label="Remove selected image"
                >
                  <IconX size={14} />
                </button>
              </div>
            )}
            <div className="message-input-controls">
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileChange}
                hidden
              />
              <button
                type="button"
                className="message-attach-button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach an image"
              >
                <IconPhoto size={20} />
              </button>
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a message…"
              />
              <button type="submit" disabled={sending || (!draft.trim() && !imageFile)}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        ) : (
          <p className="empty-state">Admins have read-only access to messages.</p>
        )}
      </section>

      {lightboxUrl && (
        <div className="image-lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <button
            type="button"
            className="image-lightbox-close"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close image"
          >
            <IconX size={24} />
          </button>
          <img
            src={lightboxUrl}
            alt="Shared attachment, full size"
            className="image-lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
