import { useMemo, useState } from 'react'
import {
  assignedDistanceSummary,
  formatDateHeading,
  formatDistanceValue,
  formatTimeRange,
  loggedDistanceSummary,
  unitAbbrev,
  workoutTypeLabel,
} from '../utils/format'
import { toDateStr } from '../utils/week'
import EventCard from './EventCard'
import TargetVsActual from './TargetVsActual'
import LogWorkoutForm from './LogWorkoutForm'
import Modal from './Modal'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const MAX_NAMES_PER_CELL = 2

// Leading/trailing days from adjacent months fill the grid to a full week
// row — `new Date(year, month, dayNum)` naturally rolls dayNum <= 0 or
// > days-in-month into the surrounding month, so no manual leap-year/
// month-length math is needed.
function buildMonthGrid(year, month) {
  const startWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7

  const cells = []
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(year, month, i - startWeekday + 1)
    cells.push({ date, dateStr: toDateStr(date), inMonth: date.getMonth() === month })
  }
  return cells
}

// Distance shown directly on a day cell (athlete calendar only) — in
// whatever unit was actually used to assign/log it (falling back to a
// converted miles total only when a single workout mixes units — see
// loggedDistanceSummary/assignedDistanceSummary). Actual logged distance
// always wins over the assigned target once a distance-type workout exists
// for the day, whether or not it fulfills an assignment — a day logged with
// no assignment at all still shows its distance, same as one that does.
function dayDistance(dateStr, dayAssignments, workoutsByDate) {
  const workout = workoutsByDate[dateStr]
  const logged = workout ? loggedDistanceSummary(workout) : null
  if (logged) return { ...logged, isActual: true, type: workout.type }

  for (const a of dayAssignments) {
    const assigned = assignedDistanceSummary(a)
    if (assigned) return { ...assigned, isActual: false, type: a.type }
  }
  return null
}

// `events`: full events array (each with .date "YYYY-MM-DD"). `isCoach`/
// `onEdit`/`onDelete`/`editing` are forwarded to EventCard for the
// day-detail panel, same as EventsPage's own list — clicking a date just
// surfaces the same cards, not a separate read path (including its "View
// lineup" link and, when editing, its inline edit form).
//
// `assignments`/`workoutByAssignment` are optional — only EventsPage's
// athlete branch passes them (coach/admin pass nothing, so this whole path
// is a no-op for them). `assignments` is the viewing athlete's own
// assigned_workouts rows (with nested segment/target children);
// `workoutByAssignment` maps assignment id -> their matching logged workout
// (if any), for TargetVsActual. `canLog` (athlete-only) lets every day be
// selected, not just ones with events/assignments, and switches on the
// day-panel's unified log/edit action; `workoutsByDate` (keyed by "YYYY-MM-DD")
// is used to route that action to editing an existing log instead of
// creating a new one. The log/edit action opens LogWorkoutForm right here in
// a Modal — no navigation to a separate page at all, so logging/editing
// never leaves the calendar; `onWorkoutSaved` (required when canLog) tells
// the parent to refetch so the day panel/indicators reflect the change.
//
// `showAthleteData` (defaults to `canLog`) separately controls whether every
// day is selectable and shows mileage/logged-workout info at all, so a coach
// viewing an athlete's calendar read-only (AthleteCalendarPage) can pass
// `canLog={false} showAthleteData={true}` — sees exactly what the athlete
// sees, just without any log/edit action rendered.
export default function EventCalendar({
  events,
  isCoach,
  onEdit,
  onDelete,
  editing,
  assignments = [],
  workoutByAssignment = {},
  canLog = false,
  showAthleteData = canLog,
  workoutsByDate = {},
  onWorkoutSaved,
}) {
  const today = new Date()
  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(null)
  const [logModal, setLogModal] = useState(null) // { workoutId } | { initialAssignmentId, initialDate } | { initialDate }

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const todayStr = toDateStr(today)

  // Centered on whatever year is currently in view (not a fixed range off
  // today's year) so the dropdown always has a matching option, even after
  // navigating far away via Prev/Next.
  const yearOptions = useMemo(() => {
    const years = []
    for (let y = year - 5; y <= year + 5; y++) years.push(y)
    return years
  }, [year])

  const eventsByDate = useMemo(() => {
    const map = new Map()
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, [])
      map.get(e.date).push(e)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
    }
    return map
  }, [events])

  const assignmentsByDate = useMemo(() => {
    const map = new Map()
    for (const a of assignments) {
      if (!map.has(a.date)) map.set(a.date, [])
      map.get(a.date).push(a)
    }
    return map
  }, [assignments])

  const cells = useMemo(() => buildMonthGrid(year, month), [year, month])

  function goToMonth(delta) {
    setViewDate(new Date(year, month + delta, 1))
  }

  function goToday() {
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelectedDate(todayStr)
  }

  function selectMonth(newMonth) {
    setViewDate(new Date(year, newMonth, 1))
  }

  function selectYear(newYear) {
    setViewDate(new Date(newYear, month, 1))
  }

  function selectDate(dateStr, hasEvents, hasAssignment) {
    if (!showAthleteData && !hasEvents && !hasAssignment) return
    setSelectedDate((prev) => (prev === dateStr ? null : dateStr))
  }

  const selectedEvents = selectedDate ? eventsByDate.get(selectedDate) || [] : []
  const selectedAssignments = selectedDate ? assignmentsByDate.get(selectedDate) || [] : []
  const selectedWorkout = selectedDate ? workoutsByDate[selectedDate] : null
  // A future date can't have a log yet — it hasn't happened. Only gates
  // *creating* a new log; an already-existing one (edge case: logged before
  // this restriction existed) stays editable, and assigned workouts/events
  // still show normally either way.
  const isFutureDate = Boolean(selectedDate) && selectedDate > todayStr

  function openLogModal() {
    if (selectedWorkout) {
      setLogModal({ workoutId: selectedWorkout.id })
    } else if (selectedAssignments.length > 0) {
      setLogModal({ initialAssignmentId: selectedAssignments[0].id, initialDate: selectedDate })
    } else {
      setLogModal({ initialDate: selectedDate })
    }
  }

  function closeLogModal() {
    setLogModal(null)
  }

  function handleWorkoutSaved() {
    setLogModal(null)
    onWorkoutSaved?.()
  }

  return (
    <div className="event-calendar">
      <div className="calendar-nav">
        <button type="button" className="link-button" onClick={() => goToMonth(-1)} aria-label="Previous month">
          ← Prev
        </button>
        <div className="calendar-nav-title">
          <select
            className="calendar-month-select"
            value={month}
            onChange={(e) => selectMonth(Number(e.target.value))}
            aria-label="Select month"
          >
            {MONTH_LABELS.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="calendar-year-select"
            value={year}
            onChange={(e) => selectYear(Number(e.target.value))}
            aria-label="Select year"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button type="button" className="link-button" onClick={goToday}>
            Today
          </button>
        </div>
        <button type="button" className="link-button" onClick={() => goToMonth(1)} aria-label="Next month">
          Next →
        </button>
      </div>

      <div className="calendar-grid">
        {WEEKDAY_LABELS.map((label) => (
          <div className="calendar-weekday" key={label}>
            {label}
          </div>
        ))}

        {cells.map(({ date, dateStr, inMonth }) => {
          // Only the selected month's own days render anything — leading/
          // trailing days from adjacent months just fill out the grid's
          // alignment as blank, non-interactive placeholders.
          if (!inMonth) {
            return <div className="calendar-cell calendar-cell-outside" key={dateStr} aria-hidden="true" />
          }

          const dayEvents = eventsByDate.get(dateStr) || []
          const dayAssignments = assignmentsByDate.get(dateStr) || []
          const hasEvents = dayEvents.length > 0
          const hasAssignment = dayAssignments.length > 0
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const distance = showAthleteData ? dayDistance(dateStr, dayAssignments, workoutsByDate) : null

          return (
            <button
              type="button"
              key={dateStr}
              className={[
                'calendar-cell',
                isToday && 'calendar-cell-today',
                isSelected && 'calendar-cell-selected',
                hasEvents && 'calendar-cell-has-events',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => selectDate(dateStr, hasEvents, hasAssignment)}
              disabled={!showAthleteData && !hasEvents && !hasAssignment}
            >
              <span className="calendar-cell-date">{date.getDate()}</span>
              {distance && (
                <span
                  className={`calendar-cell-miles type-${distance.type} ${distance.isActual ? 'is-actual' : 'is-target'}`}
                >
                  {formatDistanceValue(distance.value, distance.unit)}
                  {unitAbbrev(distance.unit)}
                </span>
              )}
              {(hasEvents || hasAssignment) && (
                <span className="calendar-cell-indicators" aria-hidden="true">
                  {hasEvents && <span className="calendar-cell-dot" />}
                  {dayAssignments.map((a) => (
                    <span
                      key={a.id}
                      className={`calendar-cell-assignment-dot type-${a.type} ${a.status === 'completed' ? 'is-complete' : 'is-pending'}`}
                    />
                  ))}
                </span>
              )}
              {hasEvents && (
                <span className="calendar-cell-events">
                  {dayEvents.slice(0, MAX_NAMES_PER_CELL).map((e) => (
                    <span className="calendar-cell-event-name" key={e.id} title={eventTimeHint(e) || undefined}>
                      {e.name}
                    </span>
                  ))}
                  {dayEvents.length > MAX_NAMES_PER_CELL && (
                    <span className="calendar-cell-event-more">
                      +{dayEvents.length - MAX_NAMES_PER_CELL} more
                    </span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selectedDate && (selectedEvents.length > 0 || selectedAssignments.length > 0 || showAthleteData) && (
        <div className="calendar-day-panel">
          <h3>{formatDateHeading(selectedDate)}</h3>
          {selectedEvents.length > 0 && (
            <div className="events-list">
              {selectedEvents.map((e) => (
                <EventCard key={e.id} event={e} isCoach={isCoach} onEdit={onEdit} onDelete={onDelete} editing={editing} />
              ))}
            </div>
          )}
          {selectedAssignments.length > 0 ? (
            <div className="assignments-list">
              {selectedAssignments.map((a, i) => (
                <div key={a.id} className="assignment-card">
                  <div className="assignment-card-header">
                    <div>
                      <span className={`type-badge type-${a.type}`}>{workoutTypeLabel(a.type)}</span>
                    </div>
                    {a.status === 'completed' && <span className="status-badge status-completed">completed</span>}
                  </div>
                  {a.notes && <p className="workout-notes">{a.notes}</p>}
                  <TargetVsActual assignment={a} workout={workoutByAssignment[a.id]} />
                  {canLog && i === 0 && (
                    selectedWorkout ? (
                      <button type="button" className="calendar-log-action" onClick={openLogModal}>
                        Edit workout
                      </button>
                    ) : isFutureDate ? (
                      <p className="empty-state calendar-log-action">You can't log a workout for a future date yet.</p>
                    ) : (
                      <button type="button" className="calendar-log-action" onClick={openLogModal}>
                        Log this workout
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          ) : showAthleteData && selectedWorkout ? (
            <div className="assignments-list">
              <div className="assignment-card">
                <div className="assignment-card-header">
                  <div>
                    <span className={`type-badge type-${selectedWorkout.type}`}>
                      {workoutTypeLabel(selectedWorkout.type)}
                    </span>
                  </div>
                </div>
                {selectedWorkout.notes && <p className="workout-notes">{selectedWorkout.notes}</p>}
                {canLog && (
                  <button type="button" className="calendar-log-action" onClick={openLogModal}>
                    Edit workout
                  </button>
                )}
              </div>
            </div>
          ) : (
            canLog &&
            (isFutureDate ? (
              <p className="empty-state calendar-log-action">You can't log a workout for a future date yet.</p>
            ) : (
              <button type="button" className="calendar-log-action" onClick={openLogModal}>
                Log a workout
              </button>
            ))
          )}
        </div>
      )}

      {logModal && (
        <Modal onClose={closeLogModal} labelledBy="log-workout-modal-heading">
          <LogWorkoutForm
            workoutId={logModal.workoutId}
            initialAssignmentId={logModal.initialAssignmentId}
            initialDate={logModal.initialDate}
            onSaved={handleWorkoutSaved}
            onCancel={closeLogModal}
          />
        </Modal>
      )}
    </div>
  )
}

function eventTimeHint(event) {
  return formatTimeRange(event.start_time, event.end_time)
}
