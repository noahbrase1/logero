import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { createQuickNote, updateQuickNote } from '../lib/workouts'

const today = () => new Date().toISOString().slice(0, 10)

// Pass `editingNote` ({ id, date, notes }) to edit an existing note in place
// instead of posting a new one.
export default function QuickNoteForm({ onPosted, editingNote = null }) {
  const { user } = useAuth()
  const isEditing = Boolean(editingNote)
  const [date, setDate] = useState(editingNote?.date || today())
  const [content, setContent] = useState(editingNote?.notes || '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!content.trim()) {
      setError('Write something before posting.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const note = isEditing
        ? await updateQuickNote(editingNote.id, { date, content: content.trim() })
        : await createQuickNote({ userId: user.id, date, content: content.trim() })
      if (!isEditing) {
        setContent('')
        setDate(today())
      }
      onPosted?.(note)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="quick-note-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      <label>
        Note
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="What's going on today?"
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Post note'}
      </button>
    </form>
  )
}
