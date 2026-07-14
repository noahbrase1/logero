import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  createEventEntry,
  deleteEventEntry,
  fetchEventById,
  fetchEventEntries,
  reorderEventEntries,
  updateEventEntry,
} from '../lib/events'
import { fetchApprovedAthletes } from '../lib/workouts'
import { formatDate, formatTime, formatTimeRange } from '../utils/format'
import { downloadLineupPdf } from '../utils/lineupPdf'
import { groupAthletesByTeam } from '../utils/lineup'
import EventEntryForm from '../components/EventEntryForm'

export default function EventDetailPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const isCoach = profile?.role === 'coach'

  const [event, setEvent] = useState(null)
  const [entries, setEntries] = useState([])
  const [athletes, setAthletes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    setError('')
    Promise.all([fetchEventById(id), fetchEventEntries(id), isCoach ? fetchApprovedAthletes() : Promise.resolve([])])
      .then(([eventData, entryData, athleteData]) => {
        setEvent(eventData)
        setEntries(entryData)
        setAthletes(athleteData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [id])

  function startAdd() {
    setEditingEntry(null)
    setFormOpen(true)
  }

  function startEdit(entry) {
    setEditingEntry(entry)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingEntry(null)
  }

  async function handleSubmit(values) {
    setSaving(true)
    setError('')
    try {
      if (editingEntry) {
        await updateEventEntry(editingEntry.id, values)
      } else {
        await createEventEntry({ eventId: id, orderIndex: entries.length, ...values })
      }
      closeForm()
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(entryId) {
    setError('')
    try {
      await deleteEventEntry(entryId)
      setEntries((prev) => prev.filter((e) => e.id !== entryId))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleMove(index, direction) {
    const target = index + direction
    if (target < 0 || target >= entries.length) return
    const next = [...entries]
    ;[next[index], next[target]] = [next[target], next[index]]
    setEntries(next)
    try {
      await reorderEventEntries(next)
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  async function handleSortByTime() {
    const sorted = [...entries].sort((a, b) => {
      if (!a.scheduled_time) return 1
      if (!b.scheduled_time) return -1
      return a.scheduled_time.localeCompare(b.scheduled_time)
    })
    setEntries(sorted)
    try {
      await reorderEventEntries(sorted)
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  if (loading) {
    return (
      <div className="page loading-state">
        <span className="spinner" /> Loading event…
      </div>
    )
  }
  if (error && !event) return <div className="page form-error">{error}</div>
  if (!event) return null

  const timeRange = formatTimeRange(event.start_time, event.end_time)

  return (
    <div className="page">
      <Link to="/events" className="link-button">
        ← Back to events
      </Link>

      <div className="page-header-row">
        <div>
          <h1>{event.name}</h1>
          <p className="page-subtitle">
            {formatDate(event.date)}
            {timeRange && ` — ${timeRange}`}
            {event.location ? ` — ${event.location}` : ''}
          </p>
        </div>
        {isCoach && !formOpen && (
          <button type="button" onClick={startAdd}>
            + Add entry
          </button>
        )}
      </div>

      {event.notes && <p className="workout-notes">{event.notes}</p>}

      {formOpen && (
        <EventEntryForm
          athletes={athletes}
          initialEntry={editingEntry}
          onSubmit={handleSubmit}
          onCancel={closeForm}
          saving={saving}
        />
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="page-header-row">
        <h2 className="events-section-heading">Lineup</h2>
        <div className="lineup-header-actions">
          {isCoach && entries.length > 1 && (
            <button type="button" className="link-button" onClick={handleSortByTime}>
              Sort by time
            </button>
          )}
          {entries.length > 0 && (
            <button type="button" className="secondary" onClick={() => downloadLineupPdf(event, entries)}>
              Download PDF
            </button>
          )}
        </div>
      </div>

      {entries.length === 0 && <p className="empty-state">No entries in this lineup yet.</p>}

      <div className="lineup-list">
        {entries.map((entry, index) => (
          <div key={entry.id} className="lineup-row">
            <div className="lineup-time">{formatTime(entry.scheduled_time)}</div>
            <div className="lineup-details">
              <div className="lineup-event-name">{entry.event_name}</div>
              {entry.event_entry_athletes.length > 0 ? (
                groupAthletesByTeam(entry.event_entry_athletes).map(([label, teamAthletes]) => (
                  <div className="lineup-athletes" key={label || 'default'}>
                    {label && <span className="lineup-team-label">{label}: </span>}
                    {teamAthletes.map((ea) => ea.profiles?.name || 'Unnamed').join(', ')}
                  </div>
                ))
              ) : (
                <div className="lineup-athletes">No athletes assigned</div>
              )}
            </div>
            {isCoach && (
              <div className="lineup-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => handleMove(index, -1)}
                  disabled={index === 0}
                  aria-label="Move entry up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => handleMove(index, 1)}
                  disabled={index === entries.length - 1}
                  aria-label="Move entry down"
                >
                  ↓
                </button>
                <button type="button" className="link-button" onClick={() => startEdit(entry)}>
                  Edit
                </button>
                <button type="button" className="link-button danger" onClick={() => handleDelete(entry.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
