import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchRecentTeamFeed } from '../lib/workouts'
import { fetchEvents } from '../lib/events'
import WorkoutListItem from '../components/WorkoutListItem'
import QuickNoteForm from '../components/QuickNoteForm'
import MetricCardRow from '../components/MetricCardRow'
import { SkeletonList } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatDateHeading } from '../utils/format'

// Groups are ordered by calendar date, newest first — a backdated entry
// that happens to be submitted very recently shouldn't pull its date group
// out of order. `workouts` arrives sorted most-recent-submission-first, and
// a plain grouping pass preserves that relative order *within* each date
// group, which is what gives same-day entries their submission-time order.
function groupByDate(workouts) {
  const byDate = new Map()
  for (const w of workouts) {
    if (!byDate.has(w.date)) byDate.set(w.date, [])
    byDate.get(w.date).push(w)
  }
  return Array.from(byDate.keys())
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((date) => ({ date, items: byDate.get(date) }))
}

export default function TeamFeedPage() {
  const { profile } = useAuth()
  const canPostNote = profile?.role === 'coach'
  const { showToast } = useToast()
  const [workouts, setWorkouts] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeDate, setActiveDate] = useState(null)
  const [noteFormOpen, setNoteFormOpen] = useState(false)
  const sectionRefs = useRef({})

  function load() {
    setLoading(true)
    Promise.all([fetchRecentTeamFeed(60), fetchEvents()])
      .then(([workoutData, eventData]) => {
        setWorkouts(workoutData)
        setEvents(eventData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const groups = useMemo(() => groupByDate(workouts), [workouts])

  const metrics = useMemo(() => {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const weekAgoStr = weekAgo.toISOString().slice(0, 10)
    const recent = workouts.filter((w) => w.date >= weekAgoStr)
    const activeAthletes = new Set(recent.map((w) => w.user_id))

    const todayStr = new Date().toISOString().slice(0, 10)
    const nextEvent = events.find((e) => e.date >= todayStr)
    const daysToEvent = nextEvent
      ? Math.round((new Date(nextEvent.date) - new Date(todayStr)) / (1000 * 60 * 60 * 24))
      : null

    return [
      { key: 'week', label: 'Logged this week', value: recent.length },
      { key: 'athletes', label: 'Athletes active this week', value: activeAthletes.size },
      { key: 'event', label: 'Days to next event', value: daysToEvent === null ? '—' : daysToEvent === 0 ? 'Today' : daysToEvent },
    ]
  }, [workouts, events])

  function scrollToDate(date) {
    setActiveDate(date)
    sectionRefs.current[date]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleNotePosted() {
    setNoteFormOpen(false)
    load()
    showToast('Note posted!')
  }

  return (
    <div className="feed-page">
      {groups.length > 0 && (
        <aside className="feed-date-nav">
          <h2 className="feed-date-nav-heading">Jump to date</h2>
          <ul className="feed-date-list">
            {groups.map(({ date, items }) => (
              <li key={date}>
                <button
                  type="button"
                  className={`feed-date-link ${date === activeDate ? 'active' : ''}`}
                  onClick={() => scrollToDate(date)}
                >
                  <span>{formatDateHeading(date)}</span>
                  <span className="feed-date-count">{items.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="feed-main">
        <div className="page-header-row">
          <div>
            <h1>Team Logs</h1>
            <p className="page-subtitle">Most recent workouts logged across the team.</p>
          </div>
          {canPostNote && !noteFormOpen && (
            <button type="button" onClick={() => setNoteFormOpen(true)}>
              + Quick note
            </button>
          )}
        </div>

        {!loading && !error && workouts.length > 0 && <MetricCardRow metrics={metrics} />}

        {canPostNote && noteFormOpen && (
          <div className="quick-note-form-wrap">
            <QuickNoteForm onPosted={handleNotePosted} />
            <button type="button" className="link-button" onClick={() => setNoteFormOpen(false)}>
              Cancel
            </button>
          </div>
        )}

        {loading && <SkeletonList count={4} />}
        {error && <p className="form-error">{error}</p>}
        {!loading && !error && workouts.length === 0 && (
          <p className="empty-state">No workouts logged yet — once the team starts logging, they'll show up here.</p>
        )}

        {groups.map(({ date, items }) => (
          <section
            key={date}
            className="feed-date-group"
            ref={(el) => {
              sectionRefs.current[date] = el
            }}
          >
            <h2 className="feed-date-heading">{formatDateHeading(date)}</h2>
            <div className="workout-list">
              {items.map((w) => (
                <WorkoutListItem key={w.id} workout={w} showAthleteName />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
