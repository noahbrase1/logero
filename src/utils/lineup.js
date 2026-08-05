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

// Best-effort guess at whether a lineup entry is a relay, from its event
// name alone ("4x400m Relay", "4 x 100", "Distance Medley Relay"). Nothing
// in the schema actually marks an entry as a relay — a group with more than
// one athlete is just as often several teammates each entered in the same
// individual event (e.g. three athletes all in "800m") as it is a relay
// squad, so group size alone can't be trusted to tell the two apart. Used
// only as RecordResultsPanel's default guess for its per-group "this is a
// relay squad" toggle — always coach-overridable, never authoritative.
export function looksLikeRelay(eventName) {
  if (!eventName) return false
  return /relay/i.test(eventName) || /\d+\s*x\s*\d+/i.test(eventName)
}
