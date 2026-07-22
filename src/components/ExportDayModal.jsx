import { useState } from 'react'
import { formatDate, summarizeAssignment, workoutTypeLabel } from '../utils/format'
import { groupAssignmentsByWorkout } from '../utils/assignmentGroups'
import { downloadAssignmentsPdf } from '../utils/assignmentsPdf'
import Modal from './Modal'

const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const groupLabel = (index) => (index < GROUP_LETTERS.length ? GROUP_LETTERS[index] : String(index + 1))

// Review step before a coach downloads a day's assigned workouts as a PDF —
// athletes are auto-grouped by identical workout (groupAssignmentsByWorkout)
// so the coach can double-check the grouping, move an athlete into a
// different group if the auto-grouping got it wrong, and reorder the groups
// themselves (e.g. "move Group B above Group A") before anything is
// exported. Purely a client-side staging step: nothing here writes back to
// assigned_workouts — moving athletes/groups only changes how the PDF lays
// them out.
export default function ExportDayModal({ dateStr, assignments, onClose }) {
  const [groups, setGroups] = useState(() => groupAssignmentsByWorkout(assignments))

  function moveGroup(index, direction) {
    const target = index + direction
    if (target < 0 || target >= groups.length) return
    setGroups((prev) => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function moveAthlete(assignmentId, fromGroupIndex, toGroupIndex) {
    if (fromGroupIndex === toGroupIndex) return
    setGroups((prev) => {
      const athlete = prev[fromGroupIndex].assignments.find((a) => a.id === assignmentId)
      if (!athlete) return prev
      const next = prev.map((g, i) => {
        if (i === fromGroupIndex) return { ...g, assignments: g.assignments.filter((a) => a.id !== assignmentId) }
        if (i === toGroupIndex) return { ...g, assignments: [...g.assignments, athlete] }
        return g
      })
      return next.filter((g) => g.assignments.length > 0)
    })
  }

  function handleDownload() {
    downloadAssignmentsPdf(dateStr, groups)
    onClose()
  }

  return (
    <Modal onClose={onClose} labelledBy="export-day-modal-heading">
      <h3 id="export-day-modal-heading">Review groups — {formatDate(dateStr)}</h3>

      {groups.length === 0 ? (
        <p className="empty-state">No assigned workouts for this day yet.</p>
      ) : (
        <>
          <p className="form-info">
            Athletes with the same workout are grouped together. Move an athlete to a different group, or reorder
            groups, before exporting.
          </p>
          <div className="export-groups-list">
            {groups.map((g, gi) => {
              const rep = g.assignments[0]
              return (
                <div className="assignment-card export-group-card" key={g.assignments.map((a) => a.id).join('-')}>
                  <div className="export-group-header">
                    <div className="export-group-heading">
                      <span className="export-group-label">Group {groupLabel(gi)}</span>
                      <span className={`type-badge type-${rep.type}`}>{workoutTypeLabel(rep.type)}</span>
                    </div>
                    <div className="export-group-move-actions">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => moveGroup(gi, -1)}
                        disabled={gi === 0}
                        aria-label="Move group up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => moveGroup(gi, 1)}
                        disabled={gi === groups.length - 1}
                        aria-label="Move group down"
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  {summarizeAssignment(rep) && <p className="export-group-summary">{summarizeAssignment(rep)}</p>}
                  {rep.notes && <p className="workout-notes">{rep.notes}</p>}

                  <ul className="export-group-athletes">
                    {g.assignments.map((a) => (
                      <li key={a.id} className="export-group-athlete-row">
                        <span>{a.profiles?.name || 'Unnamed athlete'}</span>
                        {groups.length > 1 && (
                          <label className="export-move-select">
                            Move to
                            <select
                              value={gi}
                              onChange={(e) => moveAthlete(a.id, gi, Number(e.target.value))}
                            >
                              {groups.map((_, ti) => (
                                <option key={ti} value={ti}>
                                  Group {groupLabel(ti)}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="form-row">
        <button type="button" onClick={handleDownload} disabled={groups.length === 0}>
          Download PDF
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
