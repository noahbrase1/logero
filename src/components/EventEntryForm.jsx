import { useState } from 'react'
import AthleteChecklist from './AthleteChecklist'

function teamsFromEntry(entry) {
  if (!entry) return [{ key: crypto.randomUUID(), label: '', selectedIds: new Set() }]

  const groups = new Map()
  for (const ea of entry.event_entry_athletes || []) {
    const key = ea.team_label || ''
    if (!groups.has(key)) groups.set(key, new Set())
    groups.get(key).add(ea.athlete_id)
  }
  if (groups.size === 0) return [{ key: crypto.randomUUID(), label: '', selectedIds: new Set() }]

  return Array.from(groups.entries()).map(([label, selectedIds]) => ({
    key: crypto.randomUUID(),
    label,
    selectedIds,
  }))
}

// `initialEntry` (an event_entries row with nested event_entry_athletes) for
// edit mode, or omitted to add a new entry. Most entries have a single,
// unlabeled group of athletes; "+ Add team" splits that into labeled
// sub-teams (Team A / Team B) for relays with more than one squad.
export default function EventEntryForm({ athletes, initialEntry, onSubmit, onCancel, saving }) {
  const [eventName, setEventName] = useState(initialEntry?.event_name || '')
  const [scheduledTime, setScheduledTime] = useState(initialEntry?.scheduled_time?.slice(0, 5) || '')
  const [teams, setTeams] = useState(() => teamsFromEntry(initialEntry))
  const [error, setError] = useState('')

  function toggleAthlete(teamIndex, athleteId) {
    setTeams((prev) =>
      prev.map((t, i) => {
        if (i !== teamIndex) return t
        const next = new Set(t.selectedIds)
        if (next.has(athleteId)) next.delete(athleteId)
        else next.add(athleteId)
        return { ...t, selectedIds: next }
      })
    )
  }

  function updateTeamLabel(teamIndex, label) {
    setTeams((prev) => prev.map((t, i) => (i === teamIndex ? { ...t, label } : t)))
  }

  function addTeam() {
    setTeams((prev) => {
      const next = prev.map((t, i) => (i === 0 && !t.label ? { ...t, label: 'Team A' } : t))
      const nextLetter = String.fromCharCode(65 + next.length)
      next.push({ key: crypto.randomUUID(), label: `Team ${nextLetter}`, selectedIds: new Set() })
      return next
    })
  }

  function removeTeam(teamIndex) {
    setTeams((prev) => {
      const next = prev.filter((_, i) => i !== teamIndex)
      if (next.length === 1) next[0] = { ...next[0], label: '' }
      return next
    })
  }

  function otherTeamsSelectedIds(teamIndex) {
    const ids = new Set()
    teams.forEach((t, i) => {
      if (i !== teamIndex) t.selectedIds.forEach((id) => ids.add(id))
    })
    return ids
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!eventName.trim()) {
      setError('Enter an event name.')
      return
    }
    setError('')
    onSubmit({
      eventName: eventName.trim(),
      scheduledTime: scheduledTime || null,
      teams: teams.map((t) => ({ label: t.label.trim(), athleteIds: Array.from(t.selectedIds) })),
    })
  }

  return (
    <form className="workout-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>
          Event name
          <input
            type="text"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="4x400m Relay"
            required
          />
        </label>
        <label>
          Scheduled time
          <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
        </label>
      </div>

      <fieldset className="splits-fieldset">
        <legend>Athletes</legend>
        {athletes.length === 0 ? (
          <p className="empty-state">No approved athletes yet.</p>
        ) : (
          <div className="entry-teams">
            {teams.map((team, index) => (
              <div className="entry-team-block" key={team.key}>
                {teams.length > 1 && (
                  <div className="entry-team-header">
                    <input
                      type="text"
                      className="entry-team-label-input"
                      value={team.label}
                      onChange={(e) => updateTeamLabel(index, e.target.value)}
                      placeholder="Team A"
                    />
                    <button type="button" className="link-button danger" onClick={() => removeTeam(index)}>
                      Remove team
                    </button>
                  </div>
                )}
                <AthleteChecklist
                  athletes={athletes}
                  selectedIds={team.selectedIds}
                  onToggle={(athleteId) => toggleAthlete(index, athleteId)}
                  disabledIds={otherTeamsSelectedIds(index)}
                />
              </div>
            ))}
            <button type="button" className="add-row" onClick={addTeam}>
              + Add team
            </button>
          </div>
        )}
      </fieldset>

      {error && <p className="form-error">{error}</p>}

      <div className="form-row">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : initialEntry ? 'Save changes' : 'Add entry'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
