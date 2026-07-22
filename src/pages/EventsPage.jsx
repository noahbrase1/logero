import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { createEvent, deleteEvent, fetchEvents, updateEvent } from '../lib/events'
import { fetchAssignmentsForAthlete } from '../lib/assignments'
import { fetchApprovedAthletes, fetchWorkouts } from '../lib/workouts'
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
  const isAdmin = profile?.role === 'admin'
  const isAthlete = profile?.role === 'athlete'

  const [events, setEvents] = useState([])
  const [athletes, setAthletes] = useState([])
  const [selectedAthleteId, setSelectedAthleteId] = useState('')
  const [assignments, setAssignments] = useState([])
  const [workoutByAssignment, setWorkoutByAssignment] = useState({})
  const [workoutsByDate, setWorkoutsByDate] = useState({})
  const [loading, setLoading] = useState(true)
  const [athleteDataLoading, setAthleteDataLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState('calendar')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  // An athlete always views their own calendar; a coach/admin views the
  // team calendar by default but can pick any athlete from the dropdown
  // below to see that athlete's own calendar instead (read-only for them —
  // canLog stays athlete-only, see EventCalendar's canLog prop below).
  const targetUserId = isAthlete ? user.id : selectedAthleteId || null

  // Events (+ the athlete picker's roster, for coach/admin) load once on
  // mount — unrelated to which athlete's assignments/logs are shown below.
  function loadBase() {
    setLoading(true)
    const requests = [fetchEvents(), isCoach || isAdmin ? fetchApprovedAthletes() : Promise.resolve([])]
    Promise.all(requests)
      .then(([eventData, athleteData]) => {
        setEvents(eventData)
        setAthletes(athleteData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(loadBase, [])

  // Assignments + logged workouts for whichever user's calendar is being
  // shown (the athlete themself, or a coach/admin's selected athlete), so
  // the calendar can show assigned workouts alongside team events, and so
  // logging/editing (via EventCalendar's in-modal LogWorkoutForm, athlete
  // view only) has what it needs to detect an existing log per day.
  function loadAthleteData() {
    if (!targetUserId) {
      setAssignments([])
      setWorkoutByAssignment({})
      setWorkoutsByDate({})
      return
    }
    setAthleteDataLoading(true)
    Promise.all([fetchAssignmentsForAthlete(targetUserId), fetchWorkouts({ userId: targetUserId })])
      .then(([assignmentData, workouts]) => {
        setAssignments(assignmentData)
        const map = {}
        const byDate = {}
        workouts.forEach((w) => {
          if (w.assignment_id) map[w.assignment_id] = w
          byDate[w.date] = w
        })
        setWorkoutByAssignment(map)
        setWorkoutsByDate(byDate)
      })
      .catch((err) => setError(err.message))
      .finally(() => setAthleteDataLoading(false))
  }

  useEffect(loadAthleteData, [targetUserId])

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
      loadBase()
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
      loadBase()
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
        <h1>Calendar</h1>
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
            <button
              type="button"
              className={view === 'calendar' ? 'active' : ''}
              onClick={() => setView('calendar')}
            >
              Calendar
            </button>
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
              Events
            </button>
          </div>

          {view === 'calendar' && (isCoach || isAdmin) && (
            <div className="filter-bar">
              <label>
                View athlete's calendar
                <select value={selectedAthleteId} onChange={(e) => setSelectedAthleteId(e.target.value)}>
                  <option value="">Team calendar</option>
                  {athletes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || 'Unnamed athlete'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {view === 'calendar' && selectedAthleteId && (
            <p className="form-info">
              Viewing {athletes.find((a) => a.id === selectedAthleteId)?.name || 'this athlete'}'s calendar — read-only.
            </p>
          )}

          {view === 'calendar' ? (
            athleteDataLoading ? (
              <SkeletonList count={3} />
            ) : (
              <EventCalendar
                events={events}
                isCoach={isCoach}
                onEdit={startEdit}
                onDelete={handleDelete}
                editing={editingState}
                assignments={assignments}
                workoutByAssignment={workoutByAssignment}
                canLog={isAthlete}
                showAthleteData={Boolean(targetUserId)}
                workoutsByDate={workoutsByDate}
                onWorkoutSaved={loadAthleteData}
              />
            )
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
