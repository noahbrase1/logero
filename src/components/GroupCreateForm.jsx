import { useEffect, useState } from 'react'
import { fetchApprovedAthletes } from '../lib/workouts'
import { createGroupConversation } from '../lib/messages'
import { useToast } from '../context/ToastContext'

export default function GroupCreateForm({ onCreated, onCancel }) {
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [athletes, setAthletes] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loadingAthletes, setLoadingAthletes] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchApprovedAthletes()
      .then(setAthletes)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingAthletes(false))
  }, [])

  function toggleAthlete(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the group a name.')
      return
    }
    if (selectedIds.size === 0) {
      setError('Select at least one athlete.')
      return
    }
    setError('')
    setSaving(true)
    try {
      const conversation = await createGroupConversation({
        name: name.trim(),
        athleteIds: Array.from(selectedIds),
      })
      showToast('Group created!')
      onCreated?.(conversation.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="dm-picker" onSubmit={handleSubmit}>
      <div className="dm-picker-title">New group</div>
      <label>
        Group name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="800m Squad" />
      </label>

      {loadingAthletes && <p className="empty-state">Loading athletes…</p>}
      {!loadingAthletes && athletes.length === 0 && <p className="empty-state">No approved athletes yet.</p>}

      {athletes.length > 0 && (
        <div className="athlete-checklist">
          {athletes.map((a) => (
            <label key={a.id} className="athlete-checklist-item">
              <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleAthlete(a.id)} />
              {a.name || 'Unnamed athlete'}
            </label>
          ))}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="form-row">
        <button type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create group'}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
