import { Link } from 'react-router-dom'
import { formatDate, formatTimeRange } from '../utils/format'
import EventForm from './EventForm'

// Shared event summary card — used by both EventsPage's list and
// EventCalendar's day-detail panel, so edit/delete (and now inline editing)
// stay consistent wherever an event shows up.
//
// `editing` (optional): { editingId, form, setForm, onSubmit, onCancel,
// saving, error } — lifted up to whichever page owns the edit state
// (EventsPage). When editingId matches this event, the card renders the
// edit form in place of its normal content, rather than a separate form
// opening elsewhere on the page.
export default function EventCard({ event, isCoach, onEdit, onDelete, editing }) {
  const isEditing = editing && editing.editingId === event.id

  if (isEditing) {
    return (
      <article className="event-card event-card-editing">
        <EventForm
          form={editing.form}
          setForm={editing.setForm}
          onSubmit={editing.onSubmit}
          onCancel={editing.onCancel}
          saving={editing.saving}
          error={editing.error}
          submitLabel="Save changes"
        />
      </article>
    )
  }

  const timeRange = formatTimeRange(event.start_time, event.end_time)

  return (
    <article className="event-card">
      <div>
        <div className="event-date">
          {formatDate(event.date)}
          {timeRange && ` — ${timeRange}`}
        </div>
        <h3>
          <Link to={`/events/${event.id}`}>{event.name}</Link>
        </h3>
        {event.location && <p className="event-location">📍 {event.location}</p>}
        {event.notes && <p className="workout-notes">{event.notes}</p>}
        <Link to={`/events/${event.id}`} className="link-button">
          View lineup →
        </Link>
      </div>
      {isCoach && (
        <div className="event-actions">
          <button type="button" className="link-button" onClick={() => onEdit(event)}>
            Edit
          </button>
          <button type="button" className="link-button danger" onClick={() => onDelete(event.id)}>
            Delete
          </button>
        </div>
      )}
    </article>
  )
}
