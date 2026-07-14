import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { addComment, fetchComments } from '../lib/workoutComments'

export default function WorkoutComments({ workoutId }) {
  const { user, profile } = useAuth()
  const isCoach = profile?.role === 'coach'

  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [comments, setComments] = useState([])
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  async function handleToggle(e) {
    if (!e.target.open || loaded) return
    setLoading(true)
    try {
      const data = await fetchComments(workoutId)
      setComments(data)
      setLoaded(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const comment = draft.trim()
    if (!comment) return
    setPosting(true)
    setError('')
    try {
      const saved = await addComment(workoutId, user.id, comment)
      setComments((prev) => [...prev, saved])
      setDraft('')
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  return (
    <details className="workout-details" onToggle={handleToggle}>
      <summary>Coach comments</summary>
      {loading && (
        <div className="loading-state">
          <span className="spinner" /> Loading…
        </div>
      )}
      {loaded && comments.length === 0 && <p className="empty-state">No comments yet.</p>}
      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id} className="comment-item">
            <span className="comment-author">{c.profiles?.name || 'Coach'}</span>
            <span className="comment-text">{c.comment}</span>
            <span className="comment-time">{new Date(c.created_at).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
      {isCoach && (
        <form className="comment-form" onSubmit={handleSubmit}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Leave a comment for this athlete…"
          />
          <button type="submit" disabled={posting || !draft.trim()}>
            Post
          </button>
        </form>
      )}
    </details>
  )
}
