import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { createAssignment, fetchAssignmentsForCoach } from '../lib/assignments'
import { fetchApprovedAthletes } from '../lib/workouts'
import { formatDate, summarizeAssignment, workoutTypeLabel } from '../utils/format'
import { toDateStr } from '../utils/week'
import AssignmentForm from '../components/AssignmentForm'
import AssignmentGrid from '../components/AssignmentGrid'
import ExportDayModal from '../components/ExportDayModal'
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

  function load() {
    setLoading(true)
    Promise.all([fetchApprovedAthletes(), fetchAssignmentsForCoach()])
      .then(([a, w]) => {
        setAthletes(a)
        setAssignments(w)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

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
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>Assigned workouts</h1>
      </div>

      {canCreate && (
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
      {exportError && <p className="form-error">{exportError}</p>}

      <div className="type-toggle">
        {canCreate && (
          <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
            Grid
          </button>
        )}
        <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
          List
        </button>
      </div>

      {view === 'grid' && canCreate ? (
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

          <h2 className="events-section-heading">All assignments</h2>
          {loading && (
            <div className="loading-state">
              <span className="spinner" /> Loading…
            </div>
          )}
          {!loading && assignments.length === 0 && (
            <p className="empty-state">No assignments yet — create one above to get started.</p>
          )}
          <div className="assignments-list">
            {assignments.map((a) => (
              <div key={a.id} className="assignment-row">
                <div>
                  <span className={`type-badge type-${a.type}`}>{workoutTypeLabel(a.type)}</span>
                  <span className="assignment-athlete">{a.profiles?.name || 'Unknown athlete'}</span>
                  <span className="workout-date">{formatDate(a.date)}</span>
                </div>
                <div className="assignment-target-summary">
                  <span>{summarizeAssignment(a)}</span>
                </div>
                <span className={`status-badge status-${a.status}`}>{a.status}</span>
              </div>
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
