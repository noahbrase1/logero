import { useEffect, useMemo, useState } from 'react'
import { IconClipboardList } from '@tabler/icons-react'
import { useAuth } from '../context/AuthContext'
import { createAssignment, fetchAssignmentsForCoach } from '../lib/assignments'
import { fetchApprovedAthletes } from '../lib/workouts'
import { addDays, formatWeekRangeLabel, parseDateStr, startOfWeek, toDateStr } from '../utils/week'
import AssignmentDayGroup from '../components/AssignmentDayGroup'
import AssignmentForm from '../components/AssignmentForm'
import AssignmentGrid from '../components/AssignmentGrid'
import ExportDayModal from '../components/ExportDayModal'
import SplitRecorder from '../components/SplitRecorder'
import { useToast } from '../context/ToastContext'

export default function CoachAssignmentsPage() {
  const { user, profile } = useAuth()
  const canCreate = profile?.role === 'coach'
  const { showToast } = useToast()
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
        <h1>
          <IconClipboardList className="page-title-icon" size={26} aria-hidden="true" />
          Assigned workouts
        </h1>
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
          List
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
