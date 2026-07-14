// Controlled checklist of athletes — reused wherever a coach picks a subset
// of the roster (event entries, workout assignments, group chats).
// `disabledIds` (optional): athletes already claimed elsewhere (e.g. another
// relay team within the same entry) — shown but unpickable, so a coach can't
// accidentally put one athlete on two teams at once.
export default function AthleteChecklist({ athletes, selectedIds, onToggle, disabledIds }) {
  return (
    <div className="athlete-checklist">
      {athletes.map((a) => {
        const disabled = disabledIds?.has(a.id) && !selectedIds.has(a.id)
        return (
          <label key={a.id} className={`athlete-checklist-item ${disabled ? 'is-disabled' : ''}`}>
            <input type="checkbox" checked={selectedIds.has(a.id)} disabled={disabled} onChange={() => onToggle(a.id)} />
            {a.name || 'Unnamed athlete'}
          </label>
        )
      })}
    </div>
  )
}
