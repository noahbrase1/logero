import { useState } from 'react'
import { fetchApprovedAthletes } from '../lib/workouts'
import { addGroupParticipants, deleteGroup, removeGroupParticipant, renameGroup } from '../lib/messages'
import { useToast } from '../context/ToastContext'

export default function GroupManageControls({ conversation, onChanged }) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)

  const [nameDraft, setNameDraft] = useState(conversation.name || '')
  const [renaming, setRenaming] = useState(false)

  const [addPickerOpen, setAddPickerOpen] = useState(false)
  const [addCandidates, setAddCandidates] = useState([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [selectedToAdd, setSelectedToAdd] = useState(new Set())
  const [adding, setAdding] = useState(false)

  const [removingId, setRemovingId] = useState(null)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [error, setError] = useState('')

  const currentAthletes = conversation.participants.filter((p) => p.user_id !== conversation.created_by)

  async function handleRename(e) {
    e.preventDefault()
    if (!nameDraft.trim()) {
      setError('Group name cannot be empty.')
      return
    }
    setError('')
    setRenaming(true)
    try {
      await renameGroup(conversation.id, nameDraft.trim())
      await onChanged()
      showToast('Group renamed')
    } catch (err) {
      setError(err.message)
    } finally {
      setRenaming(false)
    }
  }

  async function openAddPicker() {
    setAddPickerOpen(true)
    setError('')
    setLoadingCandidates(true)
    try {
      const athletes = await fetchApprovedAthletes()
      const currentIds = new Set(conversation.participants.map((p) => p.user_id))
      setAddCandidates(athletes.filter((a) => !currentIds.has(a.id)))
      setSelectedToAdd(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingCandidates(false)
    }
  }

  function toggleAddCandidate(id) {
    setSelectedToAdd((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAddAthletes() {
    if (selectedToAdd.size === 0) return
    setError('')
    setAdding(true)
    try {
      await addGroupParticipants(conversation.id, Array.from(selectedToAdd))
      setAddPickerOpen(false)
      await onChanged()
      showToast('Athletes added to group')
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(userId) {
    setError('')
    setRemovingId(userId)
    try {
      await removeGroupParticipant(conversation.id, userId)
      await onChanged()
      showToast('Athlete removed from group')
    } catch (err) {
      setError(err.message)
    } finally {
      setRemovingId(null)
    }
  }

  async function handleDelete() {
    setError('')
    setDeleting(true)
    try {
      await deleteGroup(conversation.id)
      showToast('Group deleted')
      // onChanged() reloads the conversation list and — since this
      // conversation no longer appears in it — redirects away itself (see
      // MessagesPage's handleGroupChanged). Navigating here directly used to
      // skip that reload entirely, leaving the just-deleted group sitting in
      // stale local state until the next unrelated refresh.
      await onChanged()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  return (
    <div className="group-manage">
      <button type="button" className="link-button" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide group settings' : 'Group settings'}
      </button>

      {open && (
        <div className="group-manage-panel">
          {error && <p className="form-error">{error}</p>}

          <form className="form-row" onSubmit={handleRename}>
            <label>
              Group name
              <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
            </label>
            <button type="submit" disabled={renaming || nameDraft.trim() === conversation.name}>
              {renaming ? 'Saving…' : 'Rename'}
            </button>
          </form>

          <div className="group-manage-section">
            <div className="group-manage-section-title">Members</div>
            <ul className="group-member-list">
              {currentAthletes.map((p) => (
                <li key={p.user_id}>
                  <span>{p.profiles?.name || 'Unnamed athlete'}</span>
                  <button
                    type="button"
                    className="link-button danger"
                    disabled={removingId === p.user_id}
                    onClick={() => handleRemove(p.user_id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
              {currentAthletes.length === 0 && <li className="empty-state">No athletes in this group yet.</li>}
            </ul>

            {!addPickerOpen ? (
              <button type="button" className="link-button" onClick={openAddPicker}>
                + Add athletes
              </button>
            ) : (
              <div className="dm-picker">
                {loadingCandidates && (
                  <div className="loading-state">
                    <span className="spinner" /> Loading…
                  </div>
                )}
                {!loadingCandidates && addCandidates.length === 0 && (
                  <p className="empty-state">Everyone approved is already in this group.</p>
                )}
                <div className="athlete-checklist">
                  {addCandidates.map((a) => (
                    <label key={a.id} className="athlete-checklist-item">
                      <input
                        type="checkbox"
                        checked={selectedToAdd.has(a.id)}
                        onChange={() => toggleAddCandidate(a.id)}
                      />
                      {a.name || 'Unnamed athlete'}
                    </label>
                  ))}
                </div>
                <div className="form-row">
                  <button type="button" disabled={adding || selectedToAdd.size === 0} onClick={handleAddAthletes}>
                    {adding ? 'Adding…' : 'Add selected'}
                  </button>
                  <button type="button" className="link-button" onClick={() => setAddPickerOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="group-manage-section">
            <div className="group-manage-section-title">Danger zone</div>
            {!confirmingDelete ? (
              <button type="button" className="link-button danger" onClick={() => setConfirmingDelete(true)}>
                Delete group
              </button>
            ) : (
              <div className="group-delete-confirm">
                <p className="form-error">
                  This permanently deletes "{conversation.name}" and all its messages. This can't be undone.
                </p>
                <div className="form-row">
                  <button type="button" className="danger-solid" disabled={deleting} onClick={handleDelete}>
                    {deleting ? 'Deleting…' : 'Yes, delete group'}
                  </button>
                  <button type="button" className="link-button" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
