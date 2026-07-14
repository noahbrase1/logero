// Groups an entry's event_entry_athletes rows by team_label. Unlabeled
// entries (the common case — an individual event, or a relay with only one
// squad) come back as a single group with an empty-string key.
export function groupAthletesByTeam(entryAthletes) {
  const groups = new Map()
  for (const ea of entryAthletes || []) {
    const key = ea.team_label || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(ea)
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}
