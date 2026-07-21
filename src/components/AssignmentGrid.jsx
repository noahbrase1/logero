import { useEffect, useMemo, useState } from 'react'
import {
  assignmentToFormPayload,
  createAssignment,
  deleteAssignment,
  fetchAssignmentsForCoach,
} from '../lib/assignments'
import { formatDate, summarizeAssignment } from '../utils/format'
import { addDays, formatWeekRangeLabel, startOfWeek, toDateStr } from '../utils/week'
import { useToast } from '../context/ToastContext'
import AssignmentForm from './AssignmentForm'
import Modal from './Modal'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const keyFor = (athleteId, dateStr) => `${athleteId}|${dateStr}`

// Runs `worker` over `items` with at most `concurrency` in flight at once —
// avoids both an unbounded Promise.all (up to 50 athletes × 7 days = 350
// simultaneous requests for a full grid-to-grid paste) and slow sequential
// awaits. Each item is independent (per the paste requirement that pasted
// cells aren't linked to each other), so one failing doesn't stop the rest —
// failures are collected and returned rather than thrown.
async function mapWithConcurrency(items, concurrency, worker) {
  const errors = []
  let index = 0
  async function run() {
    while (index < items.length) {
      const item = items[index++]
      try {
        await worker(item)
      } catch (err) {
        errors.push(err)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return errors
}

// Coach-only weekly athlete×day assignment grid with click-drag/ctrl-click
// selection and a copy/paste system built on one shared mechanism (see
// requestPaste/computePasteTargets — "Copy previous week" is just a preset
// clipboard + anchor through the exact same path, not separate logic).
export default function AssignmentGrid({ athletes, coachId }) {
  const { showToast } = useToast()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [assignmentsByKey, setAssignmentsByKey] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [selection, setSelection] = useState(new Set())
  const [selectionAnchor, setSelectionAnchor] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [didDrag, setDidDrag] = useState(false)
  const [selectMode, setSelectMode] = useState(false)

  const [clipboard, setClipboard] = useState(null)

  const [pendingPaste, setPendingPaste] = useState(null)
  const [pasting, setPasting] = useState(false)
  const [pasteError, setPasteError] = useState('')

  const [modalCell, setModalCell] = useState(null) // { athleteId, dateStr, existing }
  const [modalPendingPayload, setModalPendingPayload] = useState(null)
  const [modalDeleteStep, setModalDeleteStep] = useState(null) // null | 'confirm' | 'confirm-unlink'
  const [modalSaving, setModalSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i)
      return { date, dateStr: toDateStr(date) }
    }),
    [weekStart]
  )

  const athleteIndexById = useMemo(() => new Map(athletes.map((a, i) => [a.id, i])), [athletes])
  const dayIndexByDateStr = useMemo(() => new Map(days.map((d, i) => [d.dateStr, i])), [days])

  // Rolling 14-day window (previous week + current week) — the extra 7 days
  // behind is what lets "Copy previous week" work without navigating there
  // first; both weeks live in the same map, keyed by athlete+date.
  function loadWeek() {
    setLoading(true)
    setLoadError('')
    const startDate = toDateStr(addDays(weekStart, -7))
    const endDate = toDateStr(addDays(weekStart, 6))
    fetchAssignmentsForCoach({ startDate, endDate })
      .then((data) => {
        const map = new Map()
        for (const a of data) map.set(keyFor(a.athlete_id, a.date), a)
        setAssignmentsByKey(map)
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(loadWeek, [weekStart])

  useEffect(() => {
    function handleMouseUp() {
      setIsDragging(false)
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  useEffect(() => {
    function handleKeyDown(e) {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault()
        handleCopy()
      } else if (e.key.toLowerCase() === 'v') {
        e.preventDefault()
        requestPaste()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, selectionAnchor, clipboard, assignmentsByKey, athletes, days])

  function rectangleBetween(a, b) {
    const aAthleteIdx = athleteIndexById.get(a.athleteId)
    const bAthleteIdx = athleteIndexById.get(b.athleteId)
    const aDayIdx = dayIndexByDateStr.get(a.dateStr)
    const bDayIdx = dayIndexByDateStr.get(b.dateStr)
    const minA = Math.min(aAthleteIdx, bAthleteIdx)
    const maxA = Math.max(aAthleteIdx, bAthleteIdx)
    const minD = Math.min(aDayIdx, bDayIdx)
    const maxD = Math.max(aDayIdx, bDayIdx)
    const next = new Set()
    for (let ai = minA; ai <= maxA; ai++) {
      for (let di = minD; di <= maxD; di++) {
        next.add(keyFor(athletes[ai].id, days[di].dateStr))
      }
    }
    return next
  }

  function handleCellMouseDown(e, athleteId, dateStr) {
    if (selectMode) return // touch mode: onClick alone handles additive selection
    const cellKey = keyFor(athleteId, dateStr)

    if (e.shiftKey && selectionAnchor) {
      e.preventDefault()
      setSelection(rectangleBetween(selectionAnchor, { athleteId, dateStr }))
      setDidDrag(true) // suppress the modal-opening click that follows
      return
    }
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      setSelection((prev) => {
        const next = new Set(prev)
        if (next.has(cellKey)) next.delete(cellKey)
        else next.add(cellKey)
        return next
      })
      setSelectionAnchor({ athleteId, dateStr })
      setDidDrag(true)
      return
    }

    setSelection(new Set([cellKey]))
    setSelectionAnchor({ athleteId, dateStr })
    setIsDragging(true)
    setDidDrag(false)
  }

  function handleCellMouseEnter(athleteId, dateStr) {
    if (!isDragging || selectMode) return
    setDidDrag(true)
    setSelection(rectangleBetween(selectionAnchor, { athleteId, dateStr }))
  }

  function handleCellClick(athleteId, dateStr) {
    const cellKey = keyFor(athleteId, dateStr)

    if (selectMode) {
      setSelection((prev) => {
        const next = new Set(prev)
        if (next.has(cellKey)) next.delete(cellKey)
        else next.add(cellKey)
        return next
      })
      setSelectionAnchor({ athleteId, dateStr })
      return
    }

    if (didDrag) {
      setDidDrag(false)
      return
    }

    setModalCell({ athleteId, dateStr, existing: assignmentsByKey.get(cellKey) || null })
  }

  function handleCopy() {
    if (selection.size === 0) {
      showToast('Select at least one cell to copy first', 'error')
      return
    }
    const anchor = selectionAnchor
    const anchorAthleteIdx = athleteIndexById.get(anchor.athleteId)
    const anchorDayIdx = dayIndexByDateStr.get(anchor.dateStr)
    const cells = []
    for (const key of selection) {
      const [athleteId, dateStr] = key.split('|')
      const assignment = assignmentsByKey.get(key)
      if (!assignment) continue // empty selected cells contribute nothing to the clipboard
      cells.push({
        athleteOffset: athleteIndexById.get(athleteId) - anchorAthleteIdx,
        dayOffset: dayIndexByDateStr.get(dateStr) - anchorDayIdx,
        payload: assignmentToFormPayload(assignment),
      })
    }
    if (cells.length === 0) {
      showToast('Nothing to copy — select cells with an assignment first', 'error')
      return
    }
    setClipboard({ cells })
    showToast(`Copied ${cells.length} assignment${cells.length > 1 ? 's' : ''}`)
  }

  function computePasteTargets(clipboardArg, anchorArg, selectionArg) {
    if (!clipboardArg || !anchorArg) return []

    if (clipboardArg.cells.length === 1) {
      // Broadcast: one copied cell applies to every cell in the target
      // selection (covers "same day, different athletes" and "same
      // athlete, different days" as one rule). Falling back to just the
      // anchor cell covers a plain single click with no drag/ctrl selection.
      const payload = clipboardArg.cells[0].payload
      const targetKeys = selectionArg && selectionArg.size > 0 ? Array.from(selectionArg) : [keyFor(anchorArg.athleteId, anchorArg.dateStr)]
      return targetKeys.map((key) => {
        const [athleteId, dateStr] = key.split('|')
        return { athleteId, dateStr, payload }
      })
    }

    // Anchor mode: the target selection's shape is ignored — only its
    // anchor point matters, and the clipboard's relative offsets are laid
    // out from there. Offsets landing outside the loaded roster or the
    // visible Mon-Sun week are silently dropped, not wrapped/clamped.
    const anchorAthleteIdx = athleteIndexById.get(anchorArg.athleteId)
    const anchorDayIdx = dayIndexByDateStr.get(anchorArg.dateStr)
    const targets = []
    for (const cell of clipboardArg.cells) {
      const ai = anchorAthleteIdx + cell.athleteOffset
      const di = anchorDayIdx + cell.dayOffset
      if (ai < 0 || ai >= athletes.length || di < 0 || di > 6) continue
      targets.push({ athleteId: athletes[ai].id, dateStr: days[di].dateStr, payload: cell.payload })
    }
    return targets
  }

  function requestPaste(clipboardArg = clipboard, anchorArg = selectionAnchor, selectionArg = selection) {
    if (!clipboardArg) {
      showToast('Copy something first', 'error')
      return
    }
    const targets = computePasteTargets(clipboardArg, anchorArg, selectionArg)
    if (targets.length === 0) {
      showToast('Nothing to paste here', 'error')
      return
    }
    const overwrites = targets.filter((t) => assignmentsByKey.has(keyFor(t.athleteId, t.dateStr)))
    const completedOverwriteCount = overwrites.filter(
      (t) => assignmentsByKey.get(keyFor(t.athleteId, t.dateStr)).status === 'completed'
    ).length

    if (overwrites.length > 0) {
      setPendingPaste({ targets, overwriteCount: overwrites.length, completedOverwriteCount })
    } else {
      executePaste(targets)
    }
  }

  async function executePaste(targets) {
    setPasting(true)
    setPasteError('')
    const errors = await mapWithConcurrency(targets, 5, async (t) => {
      const existing = assignmentsByKey.get(keyFor(t.athleteId, t.dateStr))
      if (existing) await deleteAssignment(existing.id)
      await createAssignment({ coachId, athleteId: t.athleteId, date: t.dateStr, ...t.payload })
    })
    setPasting(false)
    setPendingPaste(null)
    if (errors.length > 0) {
      setPasteError(`${errors.length} of ${targets.length} cells failed to paste: ${errors[0].message}`)
    } else {
      showToast(`Pasted ${targets.length} assignment${targets.length > 1 ? 's' : ''}`)
    }
    loadWeek()
  }

  function cancelPendingPaste() {
    setPendingPaste(null)
  }

  // Single-click shortcut built on the exact same copy/paste mechanism: a
  // synthetic clipboard of the entire previous week, pasted anchored at the
  // current week's first athlete row + Monday.
  function handleCopyPreviousWeek() {
    const prevWeekStart = addDays(weekStart, -7)
    const cells = []
    athletes.forEach((athlete, ai) => {
      for (let di = 0; di < 7; di++) {
        const dateStr = toDateStr(addDays(prevWeekStart, di))
        const assignment = assignmentsByKey.get(keyFor(athlete.id, dateStr))
        if (assignment) {
          cells.push({ athleteOffset: ai, dayOffset: di, payload: assignmentToFormPayload(assignment) })
        }
      }
    })
    if (cells.length === 0) {
      showToast('Previous week has no assignments to copy', 'error')
      return
    }
    if (athletes.length === 0) return
    const clip = { cells }
    const anchor = { athleteId: athletes[0].id, dateStr: toDateStr(weekStart) }
    setClipboard(clip)
    setSelectionAnchor(anchor)
    requestPaste(clip, anchor, new Set())
  }

  function closeModal() {
    setModalCell(null)
    setModalPendingPayload(null)
    setModalDeleteStep(null)
    setModalError('')
  }

  function handleModalSubmit(payload) {
    if (modalCell.existing?.status === 'completed') {
      setModalPendingPayload(payload)
      return
    }
    saveModalAssignment(payload)
  }

  async function saveModalAssignment(payload) {
    setModalSaving(true)
    setModalError('')
    try {
      if (modalCell.existing) await deleteAssignment(modalCell.existing.id)
      await createAssignment({ coachId, athleteId: modalCell.athleteId, date: modalCell.dateStr, ...payload })
      showToast(modalCell.existing ? 'Assignment updated' : 'Assignment created')
      closeModal()
      loadWeek()
    } catch (err) {
      setModalError(err.message)
    } finally {
      setModalSaving(false)
    }
  }

  function handleDeleteClick() {
    setModalDeleteStep(modalCell.existing?.status === 'completed' ? 'confirm-unlink' : 'confirm')
  }

  async function confirmModalDelete() {
    setModalSaving(true)
    setModalError('')
    try {
      await deleteAssignment(modalCell.existing.id)
      showToast('Assignment deleted')
      closeModal()
      loadWeek()
    } catch (err) {
      setModalError(err.message)
    } finally {
      setModalSaving(false)
    }
  }

  const modalAthleteName = modalCell ? athletes.find((a) => a.id === modalCell.athleteId)?.name || 'Athlete' : ''

  return (
    <div className="assignment-grid-section">
      <div className="assignment-grid-toolbar">
        <div className="calendar-nav">
          <button type="button" className="link-button" onClick={() => setWeekStart((d) => addDays(d, -7))} aria-label="Previous week">
            ← Prev week
          </button>
          <div className="calendar-nav-title">
            <span>{formatWeekRangeLabel(weekStart)}</span>
            <button type="button" className="link-button" onClick={() => setWeekStart(startOfWeek(new Date()))}>
              This week
            </button>
          </div>
          <button type="button" className="link-button" onClick={() => setWeekStart((d) => addDays(d, 7))} aria-label="Next week">
            Next week →
          </button>
        </div>

        <div className="assignment-grid-actions">
          <button type="button" className="secondary" onClick={handleCopyPreviousWeek}>
            Copy previous week
          </button>
          <button type="button" className="secondary" onClick={handleCopy} disabled={selection.size === 0}>
            Copy
          </button>
          <button type="button" className="secondary" onClick={() => requestPaste()} disabled={!clipboard}>
            Paste
          </button>
          <button
            type="button"
            className={`secondary ${selectMode ? 'active' : ''}`}
            onClick={() => setSelectMode((v) => !v)}
          >
            {selectMode ? 'Select mode: on' : 'Select mode (touch)'}
          </button>
        </div>
      </div>

      {loadError && <p className="form-error">{loadError}</p>}
      {pasteError && <p className="form-error">{pasteError}</p>}

      {pendingPaste && (
        <div className="grid-paste-confirm">
          <p className="form-error">
            {pendingPaste.overwriteCount} of {pendingPaste.targets.length} cells already have an assignment
            {pendingPaste.completedOverwriteCount > 0 &&
              `, including ${pendingPaste.completedOverwriteCount} already completed by the athlete — pasting will unlink their logged workout from these`}
            . Overwrite?
          </p>
          <button type="button" className="danger-solid" onClick={() => executePaste(pendingPaste.targets)} disabled={pasting}>
            {pasting ? 'Pasting…' : 'Yes, overwrite'}
          </button>
          <button type="button" className="link-button" onClick={cancelPendingPaste} disabled={pasting}>
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading-state">
          <span className="spinner" /> Loading…
        </div>
      ) : athletes.length === 0 ? (
        <p className="empty-state">No approved athletes yet.</p>
      ) : (
        <div className="assignment-grid-wrap">
          <table className="assignment-grid">
            <thead>
              <tr>
                <th className="grid-corner-cell" />
                {days.map((d) => (
                  <th key={d.dateStr} className="grid-day-header">
                    <span className="grid-day-name">{WEEKDAY_LABELS[d.date.getDay()]}</span>
                    <span className="grid-day-date">{d.date.getDate()}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {athletes.map((athlete) => (
                <tr key={athlete.id}>
                  <th scope="row" className="grid-athlete-cell">
                    {athlete.name || 'Unnamed athlete'}
                  </th>
                  {days.map((d) => {
                    const cellKey = keyFor(athlete.id, d.dateStr)
                    const assignment = assignmentsByKey.get(cellKey)
                    const isSelected = selection.has(cellKey)
                    return (
                      <td
                        key={d.dateStr}
                        className={[
                          'grid-cell',
                          assignment && `grid-cell-filled type-${assignment.type}`,
                          isSelected && 'grid-cell-selected',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onMouseDown={(e) => handleCellMouseDown(e, athlete.id, d.dateStr)}
                        onMouseEnter={() => handleCellMouseEnter(athlete.id, d.dateStr)}
                        onClick={() => handleCellClick(athlete.id, d.dateStr)}
                        onDragStart={(e) => e.preventDefault()}
                      >
                        {assignment ? (
                          <span className="grid-cell-summary">{summarizeAssignment(assignment)}</span>
                        ) : (
                          <span className="grid-cell-empty">+</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalCell && (
        <Modal onClose={closeModal} labelledBy="cell-modal-heading">
          <h3 id="cell-modal-heading">
            {modalAthleteName} — {formatDate(modalCell.dateStr)}
          </h3>
          {modalDeleteStep ? (
            <div className="grid-paste-confirm">
              <p className="form-error">
                {modalDeleteStep === 'confirm-unlink'
                  ? `${modalAthleteName} already logged this workout. Deleting will unlink their log from this assignment — their log itself is kept, but the target-vs-actual comparison and completed status will be lost. This can't be undone.`
                  : 'Delete this assignment? This cannot be undone.'}
              </p>
              <button type="button" className="danger-solid" onClick={confirmModalDelete} disabled={modalSaving}>
                {modalSaving ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button type="button" className="link-button" onClick={() => setModalDeleteStep(null)} disabled={modalSaving}>
                Cancel
              </button>
            </div>
          ) : modalPendingPayload ? (
            <div className="grid-paste-confirm">
              <p className="form-error">
                {modalAthleteName} already logged this workout. Editing will unlink their log from this assignment —
                their log itself is kept, but the target-vs-actual comparison and completed status will be lost.
                This can't be undone.
              </p>
              <button
                type="button"
                className="danger-solid"
                onClick={() => saveModalAssignment(modalPendingPayload)}
                disabled={modalSaving}
              >
                {modalSaving ? 'Saving…' : 'Yes, continue'}
              </button>
              <button type="button" className="link-button" onClick={() => setModalPendingPayload(null)} disabled={modalSaving}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <AssignmentForm
                initialPayload={modalCell.existing ? assignmentToFormPayload(modalCell.existing) : undefined}
                onSubmit={handleModalSubmit}
                onCancel={closeModal}
                submitLabel={modalCell.existing ? 'Save changes' : 'Create assignment'}
                saving={modalSaving}
                error={modalError}
              />
              {modalCell.existing && (
                <button type="button" className="danger-solid cell-modal-delete" onClick={handleDeleteClick} disabled={modalSaving}>
                  Delete assignment
                </button>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
