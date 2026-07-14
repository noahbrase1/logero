import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { createEvent, deleteEvent, fetchEvents, updateEvent } from '../lib/events'
import { SkeletonList } from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import EventCard from '../components/EventCard'
import EventCalendar from '../components/EventCalendar'
import EventForm from '../components/EventForm'

const emptyForm = () => ({ name: '', date: '', startTime: '', endTime: '', location: '', notes: '' })

export default function EventsPage() {
  const { user, profile } = useAuth()
  const { showToast } = useToast()
  const isCoach = profile?.role === 'coach'

  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState('list')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    fetchEvents()
      .then(setEvents)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = events.filter((e) => e.date >= today)
  const past = events.filter((e) => e.date < today)

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  function startEdit(event) {
    setFormOpen(false)
    setError('')
    setEditingId(event.id)
    setForm({
      name: event.name,
      date: event.date,
      startTime: event.start_time?.slice(0, 5) || '',
      endTime: event.end_time?.slice(0, 5) || '',
      location: event.location || '',
      notes: event.notes || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm())
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await createEvent({ ...form, createdBy: user.id })
      showToast('Event created')
      setFormOpen(false)
      setForm(emptyForm())
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Edits happen in place — inside whichever EventCard is being edited
  // (list row or the calendar's day-panel card) — rather than a form
  // opening elsewhere on the page. See the `editing` object built below.
  async function handleEditSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateEvent(editingId, form)
      showToast('Event updated')
      cancelEdit()
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    setError('')
    try {
      await deleteEvent(id)
      setEvents((prev) => prev.filter((e) => e.id !== id))
      showToast('Event deleted')
    } catch (err) {
      setError(err.message)
    }
  }

  // Passed down to every EventCard (list rows and the calendar's day-panel
  // cards alike) so whichever one matches editingId renders the edit form
  // in place, instead of a separate form opening elsewhere on the page.
  const editingState = { editingId, form, setForm, onSubmit: handleEditSubmit, onCancel: cancelEdit, saving, error }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Events</h1>
        {isCoach && !formOpen && !editingId && (
          <button type="button" onClick={startCreate}>
            + New event
          </button>
        )}
      </div>

      {formOpen && (
        <EventForm
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
          saving={saving}
          error={error}
          submitLabel="Create event"
        />
      )}

      {loading && <SkeletonList count={3} />}
      {error && !formOpen && !editingId && <p className="form-error">{error}</p>}

      {!loading && (
        <>
          <div className="type-toggle">
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
              Events
            </button>
            <button
              type="button"
              className={view === 'calendar' ? 'active' : ''}
              onClick={() => setView('calendar')}
            >
              Calendar
            </button>
          </div>

          {view === 'calendar' ? (
            <EventCalendar
              events={events}
              isCoach={isCoach}
              onEdit={startEdit}
              onDelete={handleDelete}
              editing={editingState}
            />
          ) : (
            <>
              <h2 className="events-section-heading">Upcoming</h2>
              {upcoming.length === 0 && <p className="empty-state">No upcoming events.</p>}
              <div className="events-list">
                {upcoming.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    isCoach={isCoach}
                    onEdit={startEdit}
                    onDelete={handleDelete}
                    editing={editingState}
                  />
                ))}
              </div>

              {past.length > 0 && (
                <details className="past-events">
                  <summary>Past events ({past.length})</summary>
                  <div className="events-list">
                    {past
                      .slice()
                      .reverse()
                      .map((e) => (
                        <EventCard
                          key={e.id}
                          event={e}
                          isCoach={isCoach}
                          onEdit={startEdit}
                          onDelete={handleDelete}
                          editing={editingState}
                        />
                      ))}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
