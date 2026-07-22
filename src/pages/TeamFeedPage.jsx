import { useEffect, useMemo, useState } from 'react'
import { fetchApprovedAthletes, fetchRecentTeamFeed, fetchTeamWorkoutsByDate, fetchWorkouts } from '../lib/workouts'
import { fetchEvents } from '../lib/events'
import WorkoutListItem from '../components/WorkoutListItem'
import QuickNoteForm from '../components/QuickNoteForm'
import MetricCardRow from '../components/MetricCardRow'
import { SkeletonList } from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatDateHeading } from '../utils/format'
import { toDateStr } from '../utils/week'

// The main list below shows exactly one filtered view at a time — by date
// (defaulting to today) or by athlete — rather than every recent day
// stacked on one page. That flat "everything at once" layout, with a
// same-page "jump to date" sidebar for navigating it, got unusably long and
// cluttered on mobile as the team logged more workouts; a bounded, single
// view plus two dropdowns to switch it is the fix.
export default function TeamFeedPage() {
  const { profile } = useAuth()
  const canPostNote = profile?.role === 'coach'
  const { showToast } = useToast()
  const todayStr = useMemo(() => toDateStr(new Date()), [])

  // Top-60 recent feed — only powers the metrics row and the "select by
  // date" dropdown's list of dates (recent activity is what's worth
  // offering there); it's never what's rendered as the main list itself.
  const [recentWorkouts, setRecentWorkouts] = useState([])
  const [events, setEvents] = useState([])
  const [athletes, setAthletes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [noteFormOpen, setNoteFormOpen] = useState(false)

  const [filterMode, setFilterMode] = useState('date') // 'date' | 'athlete'
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [selectedAthleteId, setSelectedAthleteId] = useState('')

  const [viewWorkouts, setViewWorkouts] = useState([])
  const [viewLoading, setViewLoading] = useState(true)
  const [viewError, setViewError] = useState('')

  function load() {
    setLoading(true)
    Promise.all([fetchRecentTeamFeed(60), fetchEvents(), fetchApprovedAthletes()])
      .then(([workoutData, eventData, athleteData]) => {
        setRecentWorkouts(workoutData)
        setEvents(eventData)
        setAthletes(athleteData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  function refreshView() {
    setViewLoading(true)
    setViewError('')
    const request = filterMode === 'athlete' && selectedAthleteId
      ? fetchWorkouts({ userId: selectedAthleteId })
      : fetchTeamWorkoutsByDate(selectedDate)
    request
      .then(setViewWorkouts)
      .catch((err) => setViewError(err.message))
      .finally(() => setViewLoading(false))
  }

  useEffect(refreshView, [filterMode, selectedDate, selectedAthleteId])

  // Every date with recent activity, plus today even if nothing's been
  // logged yet — so the dropdown's default selection always has an option.
  const dateOptions = useMemo(() => {
    const dates = new Set([todayStr])
    for (const w of recentWorkouts) dates.add(w.date)
    return Array.from(dates).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  }, [recentWorkouts, todayStr])

  const metrics = useMemo(() => {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const weekAgoStr = weekAgo.toISOString().slice(0, 10)
    const recent = recentWorkouts.filter((w) => w.date >= weekAgoStr)
    const activeAthletes = new Set(recent.map((w) => w.user_id))

    const nextEvent = events.find((e) => e.date >= todayStr)
    const daysToEvent = nextEvent
      ? Math.round((new Date(nextEvent.date) - new Date(todayStr)) / (1000 * 60 * 60 * 24))
      : null

    return [
      { key: 'week', label: 'Logged this week', value: recent.length },
      { key: 'athletes', label: 'Athletes active this week', value: activeAthletes.size },
      { key: 'event', label: 'Days to next event', value: daysToEvent === null ? '—' : daysToEvent === 0 ? 'Today' : daysToEvent },
    ]
  }, [recentWorkouts, events, todayStr])

  function handleDateChange(e) {
    setFilterMode('date')
    setSelectedDate(e.target.value)
  }

  function handleAthleteChange(e) {
    const id = e.target.value
    setSelectedAthleteId(id)
    setFilterMode(id ? 'athlete' : 'date')
  }

  function handleNotePosted() {
    setNoteFormOpen(false)
    load()
    refreshView()
    showToast('Note posted!')
  }

  const selectedAthleteName = athletes.find((a) => a.id === selectedAthleteId)?.name || 'this athlete'
  const viewHeading =
    filterMode === 'athlete'
      ? `Logs from ${selectedAthleteName}`
      : selectedDate === todayStr
        ? "Today's workouts"
        : formatDateHeading(selectedDate)
  const viewEmptyMessage =
    filterMode === 'athlete'
      ? `No workouts logged by ${selectedAthleteName} yet.`
      : selectedDate === todayStr
        ? 'No workouts logged yet today.'
        : 'No workouts logged on this date.'

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1>Team Logs</h1>
          <p className="page-subtitle">Browse workouts logged across the team, by date or by athlete.</p>
        </div>
        {canPostNote && !noteFormOpen && (
          <button type="button" onClick={() => setNoteFormOpen(true)}>
            + Quick note
          </button>
        )}
      </div>

      {!loading && !error && recentWorkouts.length > 0 && <MetricCardRow metrics={metrics} />}

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

      {!loading && !error && (
        <>
          <div className="filter-bar">
            <label>
              Select by date
              <select value={selectedDate} onChange={handleDateChange}>
                {dateOptions.map((date) => (
                  <option key={date} value={date}>
                    {date === todayStr ? 'Today' : formatDateHeading(date)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Select by athlete
              <select value={selectedAthleteId} onChange={handleAthleteChange}>
                <option value="">All athletes (by date)</option>
                {athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || 'Unnamed athlete'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h2 className="feed-view-heading">{viewHeading}</h2>

          {viewLoading && <SkeletonList count={4} />}
          {viewError && <p className="form-error">{viewError}</p>}
          {!viewLoading && !viewError && viewWorkouts.length === 0 && <p className="empty-state">{viewEmptyMessage}</p>}

          <div className="workout-list">
            {viewWorkouts.map((w) => (
              <WorkoutListItem key={w.id} workout={w} showAthleteName={filterMode === 'date'} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
