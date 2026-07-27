import { useState } from 'react'
import {
  assignmentToFormPayload,
  createAssignment,
  deleteAssignment,
  fetchAssignmentsForCoach,
} from '../lib/assignments'
import { formatDate } from '../utils/format'
import AssignmentForm from './AssignmentForm'
import Modal from './Modal'

// Lets a coach create or edit one athlete's assignment directly from that
// athlete's calendar (EventCalendar, via EventsPage's athlete picker) —
// same create/edit-by-delete-then-recreate shape as AssignmentGrid's own
// cell modal, kept as a separate component rather than shared with it (a
// different entry point with a genuinely different extra feature below),
// consistent with this app's existing per-context editors.
//
// `existing` (optional): the assignment row being edited, or omitted for a
// brand-new one. Only a brand-new assignment offers the "Also assign to…"
// checklist — editing is scoped to this one athlete, same as AssignmentGrid.
// `otherAthletes`: the rest of the roster (excluding the athlete whose
// calendar this is), for that checklist. Checking any of them replaces
// their own existing assignment for this date, if they have one — mirrors
// AssignmentGrid's paste-overwrite behavior, just without a confirmation
// step here since the coach explicitly opted each one in by name.
export default function CalendarAssignmentModal({
  coachId,
  athleteId,
  athleteName,
  dateStr,
  existing,
  otherAthletes = [],
  onClose,
  onSaved,
}) {
  const [pendingPayload, setPendingPayload] = useState(null)
  const [deleteStep, setDeleteStep] = useState(null) // null | 'confirm' | 'confirm-unlink'
  const [selectedOtherIds, setSelectedOtherIds] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleOther(id) {
    setSelectedOtherIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleFormSubmit(payload) {
    if (existing?.status === 'completed') {
      setPendingPayload(payload)
      return
    }
    save(payload)
  }

  async function save(payload) {
    setSaving(true)
    setError('')
    try {
      if (existing) await deleteAssignment(existing.id)
      await createAssignment({ coachId, athleteId, date: dateStr, ...payload })

      if (!existing && selectedOtherIds.size > 0) {
        const dayAssignments = await fetchAssignmentsForCoach({ startDate: dateStr, endDate: dateStr })
        const existingByAthlete = new Map(dayAssignments.map((a) => [a.athlete_id, a]))
        await Promise.all(
          Array.from(selectedOtherIds).map(async (id) => {
            const theirExisting = existingByAthlete.get(id)
            if (theirExisting) await deleteAssignment(theirExisting.id)
            await createAssignment({ coachId, athleteId: id, date: dateStr, ...payload })
          })
        )
      }

      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function handleDeleteClick() {
    setDeleteStep(existing?.status === 'completed' ? 'confirm-unlink' : 'confirm')
  }

  async function confirmDelete() {
    setSaving(true)
    setError('')
    try {
      await deleteAssignment(existing.id)
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="calendar-assignment-modal-heading">
      <h3 id="calendar-assignment-modal-heading">
        {athleteName} — {formatDate(dateStr)}
      </h3>

      {deleteStep ? (
        <div className="grid-paste-confirm">
          <p className="form-error">
            {deleteStep === 'confirm-unlink'
              ? `${athleteName} already logged this workout. Deleting will unlink their log from this assignment — their log itself is kept, but the target-vs-actual comparison and completed status will be lost. This can't be undone.`
              : 'Delete this assignment? This cannot be undone.'}
          </p>
          <button type="button" className="danger-solid" onClick={confirmDelete} disabled={saving}>
            {saving ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button type="button" className="link-button" onClick={() => setDeleteStep(null)} disabled={saving}>
            Cancel
          </button>
        </div>
      ) : pendingPayload ? (
        <div className="grid-paste-confirm">
          <p className="form-error">
            {athleteName} already logged this workout. Editing will unlink their log from this assignment — their
            log itself is kept, but the target-vs-actual comparison and completed status will be lost. This can't be
            undone.
          </p>
          <button type="button" className="danger-solid" onClick={() => save(pendingPayload)} disabled={saving}>
            {saving ? 'Saving…' : 'Yes, continue'}
          </button>
          <button type="button" className="link-button" onClick={() => setPendingPayload(null)} disabled={saving}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          {!existing && otherAthletes.length > 0 && (
            <fieldset className="splits-fieldset">
              <legend>Also assign to…</legend>
              <div className="athlete-checklist">
                {otherAthletes.map((a) => (
                  <label key={a.id} className="athlete-checklist-item">
                    <input type="checkbox" checked={selectedOtherIds.has(a.id)} onChange={() => toggleOther(a.id)} />
                    {a.name || 'Unnamed athlete'}
                  </label>
                ))}
              </div>
              {selectedOtherIds.size > 0 && (
                <p className="form-info">
                  Any of these athletes who already have an assignment on {formatDate(dateStr)} will have it
                  replaced.
                </p>
              )}
            </fieldset>
          )}

          <AssignmentForm
            initialPayload={existing ? assignmentToFormPayload(existing) : undefined}
            onSubmit={handleFormSubmit}
            onCancel={onClose}
            submitLabel={existing ? 'Save changes' : 'Create assignment'}
            saving={saving}
            error={error}
          />

          {existing && (
            <button type="button" className="danger-solid cell-modal-delete" onClick={handleDeleteClick} disabled={saving}>
              Delete assignment
            </button>
          )}
        </>
      )}
    </Modal>
  )
}
