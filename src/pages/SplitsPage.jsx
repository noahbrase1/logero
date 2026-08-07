import { useEffect, useMemo, useState } from 'react'
import { IconChevronLeft, IconStopwatch, IconTrophy } from '@tabler/icons-react'
import { fetchAssignmentsForCoach } from '../lib/assignments'
import { fetchEventEntries, fetchEvents } from '../lib/events'
import { fetchApprovedAthletes } from '../lib/workouts'
import { toDateStr } from '../utils/week'
import { ASSIGNED_SEGMENTS_FIELD_BY_TYPE, formatDateHeading, formatTime } from '../utils/format'
import RecordResultsPanel from '../components/RecordResultsPanel'
import SplitRecorder from '../components/SplitRecorder'
import { SkeletonList } from '../components/Skeleton'

// The single entry point for both practice split recording and meet results
// recording — previously two separate entry points (a "Record Splits" tab on
// CoachAssignmentsPage, a "Record Results" toggle on EventDetailPage), now
// consolidated here: pick a day, see everything scheduled that day (assigned
// practice workouts and meet/event lineups alike), pick one, and land in
// whichever existing tool applies (SplitRecorder or RecordResultsPanel) —
// neither of which changed at all, only how a coach reaches them did.
export default function SplitsPage() {
  const todayStr = useMemo(() => toDateStr(new Date()), [])
  const [date, setDate] = useState(todayStr)

  const [athletes, setAthletes] = useState([])
  const [dayAssignments, setDayAssignments] = useState([])
  const [dayEvents, setDayEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // null (showing the day's options) | { type: 'practice' } | { type: 'meet', event }
  const [selection, setSelection] = useState(null)

  const [entries, setEntries] = useState([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [entriesError, setEntriesError] = useState('')
  // Bumped on every entries reload so RecordResultsPanel's TimeTextInputs
  // remount and pick up freshly-saved values — same trick EventDetailPage's
  // own resultsVersion already used for this exact component.
  const [resultsVersion, setResultsVersion] = useState(0)

  useEffect(() => {
    fetchApprovedAthletes()
      .then(setAthletes)
      .catch((err) => setError(err.message))
  }, [])

  function loadDay() {
    setLoading(true)
    setError('')
    setSelection(null)
    Promise.all([fetchAssignmentsForCoach({ startDate: date, endDate: date }), fetchEvents()])
      .then(([assignments, events]) => {
        // Only running/swim/bike/other assignments have anything for
        // SplitRecorder to record against — a day with lifting-only
        // assignments shouldn't offer a dead-end "Practice workout" option
        // (SplitRecorder itself has no lifting equivalent, see its own
        // header comment).
        setDayAssignments(assignments.filter((a) => ASSIGNED_SEGMENTS_FIELD_BY_TYPE[a.type]))
        setDayEvents(events.filter((e) => e.date === date))
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadDay, [date])

  function openPractice() {
    setSelection({ type: 'practice' })
  }

  function openEvent(event) {
    setSelection({ type: 'meet', event })
    setEntriesLoading(true)
    setEntriesError('')
    fetchEventEntries(event.id)
      .then((data) => {
        setEntries(data)
        setResultsVersion((v) => v + 1)
      })
      .catch((err) => setEntriesError(err.message))
      .finally(() => setEntriesLoading(false))
  }

  function reloadEntries() {
    if (!selection || selection.type !== 'meet') return Promise.resolve()
    return fetchEventEntries(selection.event.id).then((data) => {
      setEntries(data)
      setResultsVersion((v) => v + 1)
    })
  }

  function backToOptions() {
    setSelection(null)
  }

  const practiceAthleteCount = useMemo(
    () => new Set(dayAssignments.map((a) => a.athlete_id)).size,
    [dayAssignments]
  )

  const nothingScheduled = !loading && dayAssignments.length === 0 && dayEvents.length === 0

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1>
            <IconStopwatch className="page-title-icon" size={26} aria-hidden="true" />
            Splits
          </h1>
          <p className="page-subtitle">Record practice splits or meet results for a specific day.</p>
        </div>
      </div>

      {!selection && (
        <div className="split-recorder-setup">
          <label>
            Day
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {selection ? (
        <div className="splits-selection">
          <button type="button" className="link-button splits-back-button" onClick={backToOptions}>
            <IconChevronLeft size={16} stroke={2} /> Back to {formatDateHeading(date)}
          </button>

          {selection.type === 'practice' ? (
            <SplitRecorder athletes={athletes} initialDate={date} />
          ) : (
            <>
              <h2 className="events-section-heading">{selection.event.name}</h2>
              {entriesLoading && <SkeletonList count={3} />}
              {entriesError && <p className="form-error">{entriesError}</p>}
              {!entriesLoading && !entriesError && entries.length === 0 && (
                <p className="empty-state">
                  No entries in this event's lineup yet — add athletes from the event's Lineup page first.
                </p>
              )}
              {!entriesLoading && !entriesError && entries.length > 0 && (
                <RecordResultsPanel
                  event={selection.event}
                  entries={entries}
                  resultsVersion={resultsVersion}
                  onChanged={reloadEntries}
                />
              )}
            </>
          )}
        </div>
      ) : loading ? (
        <SkeletonList count={3} />
      ) : nothingScheduled ? (
        <p className="empty-state">
          Nothing scheduled on {formatDateHeading(date)} — assign a practice workout or create an event for this day first.
        </p>
      ) : (
        <div className="splits-options-list">
          {dayAssignments.length > 0 && (
            <button type="button" className="splits-option-card" onClick={openPractice}>
              <IconStopwatch size={22} stroke={1.75} />
              <span className="splits-option-text">
                <span className="splits-option-title">Practice workout</span>
                <span className="splits-option-subtitle">
                  {practiceAthleteCount} athlete{practiceAthleteCount === 1 ? '' : 's'} assigned
                </span>
              </span>
            </button>
          )}
          {dayEvents.map((event) => (
            <button type="button" key={event.id} className="splits-option-card" onClick={() => openEvent(event)}>
              <IconTrophy size={22} stroke={1.75} />
              <span className="splits-option-text">
                <span className="splits-option-title">{event.name}</span>
                <span className="splits-option-subtitle">{formatTime(event.start_time) || 'Meet / event lineup'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
