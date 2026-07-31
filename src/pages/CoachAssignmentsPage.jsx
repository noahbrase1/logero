import { useEffect, useMemo, useState } from 'react'
import { IconClipboardList } from '@tabler/icons-react'
import { useAuth } from '../context/AuthContext'
import { createAssignment, fetchAssignmentsForCoach } from '../lib/assignments'
import { fetchEvents } from '../lib/events'
import { fetchApprovedAthletes, fetchRecentTeamFeed, fetchTeamWorkoutsByDate, fetchWorkouts } from '../lib/workouts'
import { addDays, formatWeekRangeLabel, parseDateStr, startOfWeek, toDateStr } from '../utils/week'
import { formatDateHeading } from '../utils/format'
import { onAppResume } from '../utils/appResume'
import { withTimeout } from '../utils/withTimeout'
import AssignmentDayGroup from '../components/AssignmentDayGroup'
import AssignmentForm from '../components/AssignmentForm'
import AssignmentGrid from '../components/AssignmentGrid'
import ExportDayModal from '../components/ExportDayModal'
import Fab from '../components/Fab'
import MetricCardRow from '../components/MetricCardRow'
import QuickNoteForm from '../components/QuickNoteForm'
import { SkeletonList } from '../components/Skeleton'
import SplitRecorder from '../components/SplitRecorder'
import WeeklyMileageSection from '../components/WeeklyMileageSection'
import WorkoutListItem from '../components/WorkoutListItem'
import { useToast } from '../context/ToastContext'

export default function CoachAssignmentsPage() {
  const { user, profile } = useAuth()
  const canCreate = profile?.role === 'coach'
  const { showToast } = useToast()
  const todayStr = useMemo(() => toDateStr(new Date()), [])

  const [athletes, setAthletes] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState(canCreate ? 'grid' : 'list')

  const [selectedAthleteIds, setSelectedAthleteIds] = useState(new Set())
  const [date, setDate] = useState(() => toDateStr(new Date()))
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const [formKey, setFormKey] = useState(0) // bump to remount AssignmentForm, clearing its internal state after a successful submit

  const [exportDate, setExportDate] = useState(() => toDateStr(new Date()))
  const [exportAssignments, setExportAssignments] = useState(null) // null = modal closed
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState('')

  // List view's own rolling week window — same pattern AssignmentGrid uses
  // for its week nav, replacing what used to be an unbounded
  // fetchAssignmentsForCoach() covering every assignment ever (which would
  // otherwise render every day-card at once now that the list is grouped).
  const [listWeekStart, setListWeekStart] = useState(() => startOfWeek(new Date()))

  // --- Team Logs, merged into this page's List tab (previously its own
  // standalone page/nav destination) — browsing actually-logged workouts,
  // by date or by athlete, plus quick notes and week-at-a-glance metrics.
  // Kept as its own self-contained block of state below rather than
  // interleaved with the assignment state above, since the two features
  // are deliberately just stacked together on one tab, not merged row by
  // row (an athlete's assigned workout and their logged workout for the
  // same day are still shown in two separate sections here).
  const [recentWorkouts, setRecentWorkouts] = useState([])
  const [events, setEvents] = useState([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState('')
  const [noteFormOpen, setNoteFormOpen] = useState(false)

  const [filterMode, setFilterMode] = useState('date') // 'date' | 'athlete'
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [selectedAthleteId, setSelectedAthleteId] = useState('')

  const [feedWorkouts, setFeedWorkouts] = useState([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState('')

  function loadAthletes() {
    fetchApprovedAthletes()
      .then(setAthletes)
      .catch((err) => setError(err.message))
  }

  function loadWeekAssignments() {
    setLoading(true)
    const startDate = toDateStr(listWeekStart)
    const endDate = toDateStr(addDays(listWeekStart, 6))
    fetchAssignmentsForCoach({ startDate, endDate })
      .then(setAssignments)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(loadAthletes, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadWeekAssignments, [listWeekStart])

  // Top-60 recent feed — only powers the metrics row; it's never what's
  // rendered as the main logs list itself. Wrapped in withTimeout so a dead
  // connection (most commonly: this tab was backgrounded/suspended for a
  // while) shows a retryable error instead of an indefinite spinner.
  function loadLogs() {
    setLogsLoading(true)
    setLogsError('')
    withTimeout(Promise.all([fetchRecentTeamFeed(60), fetchEvents()]), 9000)
      .then(([workoutData, eventData]) => {
        setRecentWorkouts(workoutData)
        setEvents(eventData)
      })
      .catch((err) => setLogsError(err.message))
      .finally(() => setLogsLoading(false))
  }

  useEffect(() => {
    loadLogs()
    return onAppResume(loadLogs)
  }, [])

  function refreshFeed() {
    setFeedLoading(true)
    setFeedError('')
    const request =
      filterMode === 'athlete' && selectedAthleteId
        ? fetchWorkouts({ userId: selectedAthleteId })
        : fetchTeamWorkoutsByDate(selectedDate)
    withTimeout(request, 9000)
      .then(setFeedWorkouts)
      .catch((err) => setFeedError(err.message))
      .finally(() => setFeedLoading(false))
  }

  useEffect(() => {
    refreshFeed()
    return onAppResume(refreshFeed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, selectedDate, selectedAthleteId])

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

  function handleFeedDateChange(e) {
    setFilterMode('date')
    setSelectedDate(e.target.value)
  }

  function jumpFeedToToday() {
    setFilterMode('date')
    setSelectedDate(todayStr)
  }

  function handleFeedAthleteChange(e) {
    const id = e.target.value
    setSelectedAthleteId(id)
    setFilterMode(id ? 'athlete' : 'date')
  }

  function handleNotePosted() {
    setNoteFormOpen(false)
    loadLogs()
    refreshFeed()
    showToast('Note posted!')
  }

  const selectedFeedAthleteName = athletes.find((a) => a.id === selectedAthleteId)?.name || 'this athlete'
  const feedHeading =
    filterMode === 'athlete'
      ? `Logs from ${selectedFeedAthleteName}`
      : selectedDate === todayStr
        ? "Today's workouts"
        : formatDateHeading(selectedDate)
  const feedEmptyMessage =
    filterMode === 'athlete'
      ? `No workouts logged by ${selectedFeedAthleteName} yet.`
      : selectedDate === todayStr
        ? 'No workouts logged yet today.'
        : 'No workouts logged on this date.'

  const assignmentsByDate = useMemo(() => {
    const map = new Map()
    for (const a of assignments) {
      if (!map.has(a.date)) map.set(a.date, [])
      map.get(a.date).push(a)
    }
    return map
  }, [assignments])

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => toDateStr(addDays(listWeekStart, i))), [listWeekStart])

  function toggleAthlete(id) {
    setSelectedAthleteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllAthletes() {
    setSelectedAthleteIds(new Set(athletes.map((a) => a.id)))
  }

  function clearAthleteSelection() {
    setSelectedAthleteIds(new Set())
  }

  // Fetches the chosen day's assignments and opens the review modal, where
  // the coach groups/reorders before anything actually downloads — see
  // ExportDayModal.
  async function handleExportDay() {
    setExportError('')
    setExportLoading(true)
    try {
      const data = await fetchAssignmentsForCoach({ startDate: exportDate, endDate: exportDate })
      if (data.length === 0) {
        showToast('No assignments for this day', 'error')
      } else {
        setExportAssignments(data)
      }
    } catch (err) {
      setExportError(err.message)
    } finally {
      setExportLoading(false)
    }
  }

  async function handleSubmit(payload) {
    setError('')
    setSuccess('')

    const targetAthleteIds = Array.from(selectedAthleteIds)
    if (targetAthleteIds.length === 0) {
      setError('Select at least one athlete.')
      return
    }

    setSaving(true)
    try {
      for (const id of targetAthleteIds) {
        await createAssignment({ coachId: user.id, athleteId: id, date, ...payload })
      }

      const message =
        targetAthleteIds.length > 1 ? `Assigned to ${targetAthleteIds.length} athletes.` : 'Assignment created.'
      setSuccess(message)
      showToast(message)
      clearAthleteSelection()
      setFormKey((k) => k + 1)

      // If the assignment's date falls in a different week than the one
      // currently shown below, jump there — otherwise "create assignment
      // for next Friday" would silently show no change in the list.
      const createdWeekStart = startOfWeek(parseDateStr(date))
      if (toDateStr(createdWeekStart) !== toDateStr(listWeekStart)) {
        setListWeekStart(createdWeekStart)
      } else {
        loadWeekAssignments()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1>
            <IconClipboardList className="page-title-icon" size={26} aria-hidden="true" />
            Workouts
          </h1>
          <p className="page-subtitle">Assign, record, and browse everything your team logs.</p>
        </div>
        {canCreate && view === 'list' && !noteFormOpen && (
          <>
            <button type="button" className="page-header-inline-action" onClick={() => setNoteFormOpen(true)}>
              + Quick note
            </button>
            <Fab label="Quick note" onClick={() => setNoteFormOpen(true)} />
          </>
        )}
      </div>

      {canCreate && view !== 'splits' && (
        <div className="export-day-toolbar">
          <label>
            Export day
            <input type="date" value={exportDate} onChange={(e) => setExportDate(e.target.value)} />
          </label>
          <button type="button" className="secondary" onClick={handleExportDay} disabled={exportLoading}>
            {exportLoading ? 'Loading…' : 'Export as PDF'}
          </button>
        </div>
      )}
      {view !== 'splits' && exportError && <p className="form-error">{exportError}</p>}

      <div className="type-toggle">
        {canCreate && (
          <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
            Grid
          </button>
        )}
        <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
          Logs
        </button>
        {canCreate && (
          <button type="button" className={view === 'splits' ? 'active' : ''} onClick={() => setView('splits')}>
            Record Splits
          </button>
        )}
      </div>

      {view === 'splits' && canCreate ? (
        <SplitRecorder athletes={athletes} />
      ) : view === 'grid' && canCreate ? (
        <AssignmentGrid athletes={athletes} coachId={user.id} />
      ) : (
        <>
          {canCreate && (
            <div className="workout-form">
              <fieldset className="splits-fieldset">
                <legend>Athletes</legend>
                <div className="athlete-checklist-actions">
                  <button type="button" className="link-button" onClick={selectAllAthletes}>
                    Select all
                  </button>
                  <button type="button" className="link-button" onClick={clearAthleteSelection}>
                    Clear
                  </button>
                </div>
                {athletes.length === 0 && <p className="empty-state">No approved athletes yet.</p>}
                <div className="athlete-checklist">
                  {athletes.map((a) => (
                    <label key={a.id} className="athlete-checklist-item">
                      <input type="checkbox" checked={selectedAthleteIds.has(a.id)} onChange={() => toggleAthlete(a.id)} />
                      {a.name || 'Unnamed athlete'}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="form-row">
                <label>
                  Date
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </label>
              </div>

              <AssignmentForm
                key={formKey}
                onSubmit={handleSubmit}
                submitLabel="Create assignment"
                saving={saving}
                error={error}
              />
              {success && <p className="form-info">{success}</p>}
            </div>
          )}

          <h2 className="events-section-heading">Assigned this week</h2>
          <div className="calendar-nav">
            <button
              type="button"
              className="link-button"
              onClick={() => setListWeekStart((d) => addDays(d, -7))}
              aria-label="Previous week"
            >
              ← Prev week
            </button>
            <div className="calendar-nav-title">
              <span>{formatWeekRangeLabel(listWeekStart)}</span>
              <button type="button" className="link-button" onClick={() => setListWeekStart(startOfWeek(new Date()))}>
                This week
              </button>
            </div>
            <button
              type="button"
              className="link-button"
              onClick={() => setListWeekStart((d) => addDays(d, 7))}
              aria-label="Next week"
            >
              Next week →
            </button>
          </div>

          {loading && (
            <div className="loading-state">
              <span className="spinner" /> Loading…
            </div>
          )}
          {!loading && assignments.length === 0 && (
            <p className="empty-state">No assignments this week — create one above to get started.</p>
          )}
          <div className="assignments-list">
            {weekDates
              .filter((d) => assignmentsByDate.has(d))
              .map((d) => (
                <AssignmentDayGroup key={d} dateStr={d} assignments={assignmentsByDate.get(d)} />
              ))}
          </div>

          <h2 className="events-section-heading">Team logs</h2>

          {!logsLoading && !logsError && recentWorkouts.length > 0 && <MetricCardRow metrics={metrics} />}

          {canCreate && noteFormOpen && (
            <div className="quick-note-form-wrap">
              <QuickNoteForm onPosted={handleNotePosted} />
              <button type="button" className="link-button" onClick={() => setNoteFormOpen(false)}>
                Cancel
              </button>
            </div>
          )}

          {logsLoading && <SkeletonList count={4} />}
          {logsError && (
            <p className="form-error">
              {logsError}{' '}
              <button type="button" className="link-button" onClick={loadLogs}>
                Retry
              </button>
            </p>
          )}

          {!logsLoading && !logsError && (
            <>
              <div className="filter-bar">
                <label>
                  Select by date
                  <span className="feed-date-picker">
                    <input type="date" value={selectedDate} onChange={handleFeedDateChange} />
                    {selectedDate !== todayStr && (
                      <button type="button" className="link-button" onClick={jumpFeedToToday}>
                        Today
                      </button>
                    )}
                  </span>
                </label>
                <label>
                  Select by athlete
                  <select value={selectedAthleteId} onChange={handleFeedAthleteChange}>
                    <option value="">All athletes (by date)</option>
                    {athletes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || 'Unnamed athlete'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {filterMode === 'athlete' && selectedAthleteId && <WeeklyMileageSection athleteId={selectedAthleteId} />}

              <h3 className="feed-view-heading">{feedHeading}</h3>

              {feedLoading && <SkeletonList count={4} />}
              {feedError && (
                <p className="form-error">
                  {feedError}{' '}
                  <button type="button" className="link-button" onClick={refreshFeed}>
                    Retry
                  </button>
                </p>
              )}
              {!feedLoading && !feedError && feedWorkouts.length === 0 && <p className="empty-state">{feedEmptyMessage}</p>}

              <div className="workout-list">
                {feedWorkouts.map((w) => (
                  <WorkoutListItem key={w.id} workout={w} showAthleteName={filterMode === 'date'} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {exportAssignments && (
        <ExportDayModal
          dateStr={exportDate}
          assignments={exportAssignments}
          onClose={() => setExportAssignments(null)}
        />
      )}
    </div>
  )
}
