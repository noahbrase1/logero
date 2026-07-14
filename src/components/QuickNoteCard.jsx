import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/format'
import WorkoutTypeIcon from './WorkoutTypeIcon'

// Deliberately lighter-weight than WorkoutCard — a note has no stats,
// segments, or exercises, just who said what, and when.
export default function QuickNoteCard({ note, showAthleteName = false }) {
  const { user, profile } = useAuth()
  const canEdit = profile?.role === 'athlete' && user?.id === note.user_id

  return (
    <article className="quick-note-card card-accent-note">
      <div className="quick-note-header">
        <WorkoutTypeIcon type="note" />
        <span className="type-badge type-note">Note</span>
        {showAthleteName && note.profiles?.name && <span className="athlete-name">{note.profiles.name}</span>}
        <span className="workout-date">{formatDate(note.date)}</span>
        {canEdit && (
          <Link to={`/edit/${note.id}`} className="link-button">
            Edit
          </Link>
        )}
      </div>
      <p className="quick-note-content">{note.notes}</p>
    </article>
  )
}
