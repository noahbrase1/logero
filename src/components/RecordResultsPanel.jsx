import { Fragment, useEffect, useRef, useState } from 'react'
import TimeTextInput from './TimeTextInput'
import { emptyRepTime, makeEmptySegment } from './SegmentEditor'
import { groupAthletesByTeam, looksLikeRelay } from '../utils/lineup'
import {
  computeEvenSplitSegments,
  parseEventDistance,
  recordIndividualResult,
  saveTeamResult,
  singleSegmentFromTime,
} from '../lib/meetResults'
import { formatDistanceValue, formatTime, unitAbbrev } from '../utils/format'
import { formatStopwatchClock, msToHms, useStopwatch } from '../utils/stopwatch'

function resultToTime(row) {
  return {
    hours: row?.result_hours || 0,
    minutes: row?.result_minutes || 0,
    seconds: row?.result_seconds || 0,
    centiseconds: row?.result_centiseconds || 0,
  }
}

function hasTime({ hours, minutes, seconds, centiseconds } = {}) {
  return (hours || 0) > 0 || (minutes || 0) > 0 || (seconds || 0) > 0 || (centiseconds || 0) > 0
}

function findTeamResult(entry, label) {
  return (entry.event_entry_results || []).find((r) => (r.team_label || null) === (label || null))
}

// Rebuilds a segment editor's initial state from an athlete's previously
// saved result (event_entry_athletes.workouts.running_segments, embedded by
// fetchEventEntries' ENTRY_SELECT). An athlete with nothing recorded yet
// falls back to the entry's own auto-split template — computeEvenSplitSegments()
// dividing the entry's parsed distance into entry.split_count-ish intervals
// (e.g. 1500m ÷ 4 -> 400m×3 + 300m, set once on the lineup entry itself so
// every athlete in the race starts from the same splits) — or, when the
// entry has no split_count set, one plain segment with the whole distance,
// so a coach who just wants a finish time only ever sees one column. Either
// way it's just a starting point: freely editable per athlete afterward via
// the grid's Distance/Unit/Reps columns aren't exposed here — the grid only
// edits times, not shape, so the shape comes from split_count/existing data.
function initialSegments(ea, entry) {
  const segs = ea.workouts?.running_segments
  if (segs && segs.length > 0) {
    return [...segs]
      .sort((a, b) => a.order_index - b.order_index)
      .map((s) => ({
        key: s.id,
        label: s.label || '',
        distanceValue: s.distance_value,
        distanceUnit: s.distance_unit,
        reps: s.reps,
        repTimes: (s.running_segment_reps || [])
          .slice()
          .sort((a, b) => a.rep_number - b.rep_number)
          .map((r) => ({ hours: r.time_hours, minutes: r.time_minutes, seconds: r.time_seconds, centiseconds: r.time_centiseconds })),
      }))
  }

  const distance = parseEventDistance(entry.event_name) || { value: 1, unit: 'meters' }

  const template = entry.split_count ? computeEvenSplitSegments(distance.value, distance.unit, entry.split_count) : null
  if (template) {
    return template.map((t) => ({
      key: crypto.randomUUID(),
      label: '',
      distanceValue: t.distanceValue,
      distanceUnit: t.distanceUnit,
      reps: t.reps,
      repTimes: Array.from({ length: t.reps }, () => emptyRepTime()),
    }))
  }

  const seg = makeEmptySegment({ distanceUnit: distance.unit })
  return [{ ...seg, distanceValue: distance.value }]
}

// Flattens a segments array into one grid column per rep — a segment with
// `reps: 3` becomes 3 columns, matching the same flattening SplitRecorder
// already does for its own grid (see flattenSegments() there).
function flattenColumns(segments) {
  const cols = []
  segments.forEach((seg, segIndex) => {
    const repCount = seg.repTimes?.length || Number(seg.reps) || 1
    for (let repIndex = 0; repIndex < repCount; repIndex++) {
      cols.push({ segIndex, repIndex, distanceValue: seg.distanceValue, distanceUnit: seg.distanceUnit })
    }
  })
  return cols
}

function updateSegmentRepTime(segments, segIndex, repIndex, value) {
  return segments.map((seg, si) =>
    si !== segIndex ? seg : { ...seg, repTimes: seg.repTimes.map((rt, ri) => (ri === repIndex ? value : rt)) }
  )
}

function formatColumnLabel(col) {
  if (!col) return ''
  return `${formatDistanceValue(col.distanceValue, col.distanceUnit)}${unitAbbrev(col.distanceUnit)} (${col.repIndex + 1})`
}

// Tracks whether the viewport is at/below the same 640px breakpoint the
// grid's own CSS media queries use for row height/font-size, so the column
// width can match in JS. Deliberately NOT done by routing the column width
// through a CSS custom property referenced inside grid-template-columns'
// repeat()/minmax() the way row height and the names-pane width are —
// suspected (on-device, unconfirmed) WebKit bug resolving var() specifically
// in that position, a narrower/different failure mode than the sticky-
// positioning and flex-sizing bugs already found and fixed in this same
// grid. A real number computed here and interpolated directly into the
// inline style sidesteps that whole category of risk.
function useIsNarrowViewport() {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 640
  )
  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth <= 640)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  return isNarrow
}

// A shared grid — one column per split, one row per athlete — for a group
// of athletes all running the same individual race, so a coach fills times
// across everyone at once instead of scrolling through one full segment
// editor per athlete. Unlike SplitRecorder's own grid (which needs a
// separate header per athlete, since different athletes can have entirely
// different practice assignments the same day — see SplitRecorder.jsx), a
// Record Results group is always the same race for everyone in it, so one
// shared header row is enough here; an athlete with a shorter or
// differently-shaped saved result than the rest of the group (e.g. an old
// result recorded before split_count existed) just gets non-editable "N/A"
// cells for whatever columns they don't have, mirroring SplitRecorder's own
// convention for an athlete with fewer columns than the grid's widest row.
//
// Split into two independent panes (.result-grid-names + .result-grid-scroll,
// see index.css) rather than a sticky first column inside one scrolling
// grid — position: sticky combined with a dynamically-set inline
// grid-template-columns inside overflow-x: auto reliably collapsed the
// whole grid to a single column on iOS Safari (confirmed on-device; desktop
// rendered the identical markup/data fine). The names pane never scrolls
// horizontally at all, so it needs no sticky behavior to "stay visible."
function ResultSegmentsGrid({
  entry,
  athletes,
  segmentDrafts,
  updateSegmentDraft,
  draftKey,
  resultsVersion,
  stopwatchTapVersion,
  stopwatchActive,
  onStopwatchTap,
  isStopwatchDone,
  onClear,
}) {
  const isNarrow = useIsNarrowViewport()
  const colWidth = isNarrow ? 150 : 100
  // DOM node per column index, populated by that column's own value cells
  // below (every athlete's cell at a given column sits at the same
  // horizontal offset, so any one of them works) — used purely to scroll a
  // just-recorded split into view, never for reading/writing data.
  const columnRefs = useRef(new Map())

  function handleTap(athleteId) {
    const columnIndex = onStopwatchTap(athleteId)
    if (columnIndex != null) {
      columnRefs.current.get(columnIndex)?.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' })
    }
  }

  const athleteData = athletes.map((ea) => {
    const sKey = draftKey(entry.id, 'segments', ea.athlete_id)
    const segments = segmentDrafts[sKey] ?? initialSegments(ea, entry)
    return { ea, sKey, segments, columns: flattenColumns(segments) }
  })

  const maxColumns = Math.max(0, ...athleteData.map((a) => a.columns.length))
  const headerColumns = Array.from({ length: maxColumns }, (_, i) => {
    const withCol = athleteData.find((a) => a.columns[i])
    return withCol ? withCol.columns[i] : null
  })

  return (
    <div className="result-grid-outer">
      <div className="result-grid-names">
        <div className="result-grid-names-corner">Athlete</div>
        {athleteData.map(({ ea }) => {
          const saved = resultToTime(ea)
          const done = stopwatchActive && isStopwatchDone(ea.athlete_id)
          return (
            <div className="result-grid-names-row" key={ea.athlete_id}>
              {stopwatchActive ? (
                <button
                  type="button"
                  className={`result-athlete-name-tap${done ? ' result-athlete-name-tap-done' : ''}`}
                  onClick={() => handleTap(ea.athlete_id)}
                  disabled={done}
                >
                  {ea.profiles?.name || 'Unnamed'}
                  {done && <span aria-hidden="true"> ✓</span>}
                </button>
              ) : (
                <span>{ea.profiles?.name || 'Unnamed'}</span>
              )}
              {!stopwatchActive && hasTime(saved) && (
                <button type="button" className="link-button danger" onClick={() => onClear(entry, ea.athlete_id)}>
                  Clear
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="result-grid-scroll">
        <div className="result-grid" style={{ gridTemplateColumns: `repeat(${maxColumns}, minmax(${colWidth}px, 1fr))` }}>
          {headerColumns.map((col, i) => (
            <div
              key={i}
              className={`result-grid-header-cell ${
                i > 0 && headerColumns[i - 1] && col && col.segIndex !== headerColumns[i - 1].segIndex
                  ? 'result-grid-segment-start'
                  : ''
              }`}
            >
              {formatColumnLabel(col)}
            </div>
          ))}

          {athleteData.map(({ ea, sKey, segments, columns }) => (
            <Fragment key={ea.athlete_id}>
              {Array.from({ length: maxColumns }, (_, i) => {
                const col = columns[i]
                if (!col) {
                  return (
                    <div key={i} className="result-grid-na-cell">
                      N/A
                    </div>
                  )
                }
                const segStart = i > 0 && columns[i - 1] && col.segIndex !== columns[i - 1].segIndex
                return (
                  <div
                    key={i}
                    ref={(el) => {
                      if (el) columnRefs.current.set(i, el)
                      else columnRefs.current.delete(i)
                    }}
                    className={`result-grid-value-cell ${segStart ? 'result-grid-segment-start' : ''}`}
                  >
                    <TimeTextInput
                      key={`${sKey}-${i}-${resultsVersion}-${stopwatchTapVersion}`}
                      value={segments[col.segIndex].repTimes[col.repIndex]}
                      onChange={(v) =>
                        updateSegmentDraft(sKey, updateSegmentRepTime(segments, col.segIndex, col.repIndex, v))
                      }
                      ariaLabel={`${ea.profiles?.name || 'athlete'} ${formatColumnLabel(col)}`}
                    />
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

// Coach-only race-day results entry for one event's lineup, a sibling to
// (never sharing code or tables with) the practice-day Split Recorder — see
// supabase/meet_results_schema.sql. Each lineup entry saves independently
// via its own "Save results" button, so a coach can fill results in
// whatever order events actually finish and leave the rest for later.
//
// Individual results (a whole group of athletes running the same race)
// share one grid (ResultSegmentsGrid above) rather than a full segment
// editor per athlete — a race is rarely one flat time, splits are usually
// taken at intervals (every 400m, every 200m, an irregular tail segment),
// and a coach filling in a whole heat at once wants that laid out like the
// rest of this app's split-entry grids, not one editor at a time. A relay's
// team result and its optional per-athlete leg splits stay a single
// TimeTextInput each, since those are already atomic.
//
// `resultsVersion` forces every input to remount after a reload —
// TimeTextInput only ever reads its own `value` prop once, on mount (see
// that component's header comment), so a plain re-render after a save
// wouldn't visually pick up the freshly-saved value otherwise. The same
// "remount via a changing key" trick SplitRecorder already uses for its own
// day/column-layout changes.
export default function RecordResultsPanel({ event, entries, resultsVersion, onChanged }) {
  const [savingEntryId, setSavingEntryId] = useState(null)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState({})
  const [segmentDrafts, setSegmentDrafts] = useState({})
  // Per-(entry, team_label) override of the "is this a relay squad" guess —
  // see looksLikeRelay()'s own header comment for why group size alone
  // can't be trusted (several teammates entered individually in the same
  // open event also produce a >1-athlete group).
  const [relayOverrides, setRelayOverrides] = useState({})

  // Live stopwatch mode, scoped to one lineup entry (race) at a time — see
  // useStopwatch's own header comment for why elapsed time is wall-clock-
  // anchored rather than tick-accumulated. Deliberately only ONE shared
  // clock instance here, not one per entry: `activeStopwatchEntryId` is
  // this file's enforcement of "only one race stopwatch running at once",
  // so an athlete's time from one race can never end up mixed into
  // another's clock.
  const stopwatch = useStopwatch()
  const [activeStopwatchEntryId, setActiveStopwatchEntryId] = useState(null)
  const [lastTapMs, setLastTapMs] = useState({})
  // Snapshot of drafts/segmentDrafts at the moment Start was pressed,
  // restored by Cancel Session.
  const draftSnapshotRef = useRef(null)
  // Bumped on every tap and folded (alongside resultsVersion) into every
  // TimeTextInput's key — TimeTextInput only ever reads its own `value`
  // prop once, on mount, so a tap updating drafts/segmentDrafts from
  // outside would otherwise never be visible on screen even though the
  // state itself is correct. Same trick resultsVersion already uses for a
  // post-save reload.
  const [stopwatchTapVersion, setStopwatchTapVersion] = useState(0)

  function groupKey(entryId, label) {
    return `${entryId}|${label || ''}`
  }

  function draftKey(entryId, kind, id) {
    return `${entryId}|${kind}|${id || ''}`
  }

  function updateDraft(key, value) {
    setDrafts((prev) => ({ ...prev, [key]: value }))
  }

  function updateSegmentDraft(key, value) {
    setSegmentDrafts((prev) => ({ ...prev, [key]: value }))
  }

  function isGroupRelay(entry, label, teamAthletes) {
    if (teamAthletes.length <= 1) return false
    const gKey = groupKey(entry.id, label)
    return relayOverrides[gKey] ?? looksLikeRelay(entry.event_name)
  }

  // Which team-label group a given athlete belongs to within this entry —
  // used by the stopwatch tap handler to decide whether their next split
  // goes into their own single leg-time draft (relay) or their own
  // segment/column set (individual heat), the same distinction the render
  // below already makes per group.
  function findAthleteGroup(entry, athleteId) {
    return groupAthletesByTeam(entry.event_entry_athletes).find(([, teamAthletes]) =>
      teamAthletes.some((ea) => ea.athlete_id === athleteId)
    )
  }

  function isAthleteStopwatchDone(entry, athleteId) {
    const [label, teamAthletes] = findAthleteGroup(entry, athleteId) || [null, []]
    const ea = teamAthletes.find((a) => a.athlete_id === athleteId)
    if (!ea) return true

    if (isGroupRelay(entry, label, teamAthletes)) {
      return hasTime(drafts[draftKey(entry.id, 'athlete', athleteId)] ?? resultToTime(ea))
    }

    const sKey = draftKey(entry.id, 'segments', athleteId)
    const segments = segmentDrafts[sKey] ?? initialSegments(ea, entry)
    const columns = flattenColumns(segments)
    return columns.length > 0 && columns.every((col) => hasTime(segments[col.segIndex].repTimes[col.repIndex]))
  }

  function handleStartStopwatch(entryId) {
    if (activeStopwatchEntryId && activeStopwatchEntryId !== entryId) return
    draftSnapshotRef.current = { drafts, segmentDrafts }
    setLastTapMs({})
    setActiveStopwatchEntryId(entryId)
    stopwatch.start()
  }

  // Ends the live clock but keeps whatever it recorded — the same drafts
  // "Save results" already reads from, so the coach reviews/edits them
  // exactly like manual entry before hitting Save.
  function handleFinishStopwatch() {
    stopwatch.stop()
    setActiveStopwatchEntryId(null)
  }

  function handleCancelStopwatch() {
    if (draftSnapshotRef.current) {
      setDrafts(draftSnapshotRef.current.drafts)
      setSegmentDrafts(draftSnapshotRef.current.segmentDrafts)
    }
    setLastTapMs({})
    stopwatch.reset()
    setActiveStopwatchEntryId(null)
    setStopwatchTapVersion((v) => v + 1)
  }

  // Split value = (current master clock time − this athlete's own last tap
  // time), landed in their next open slot — a single leg-time draft for a
  // relay athlete, or their own next unfilled segment/rep column for an
  // individual heat. Each athlete's own last-tap time only advances on
  // THEIR OWN tap, so athletes finishing at wildly different times never
  // affect each other's math. Returns the column index just filled (or
  // null for a relay leg, which has no columns) so ResultSegmentsGrid can
  // scroll it into view — its own scroll pane is a separate component, so
  // it can't discover that on its own.
  function handleStopwatchTap(entry, athleteId) {
    if (isAthleteStopwatchDone(entry, athleteId)) return null

    const [label, teamAthletes] = findAthleteGroup(entry, athleteId) || [null, []]
    const ea = teamAthletes.find((a) => a.athlete_id === athleteId)
    const now = stopwatch.getElapsedMs()
    const last = lastTapMs[athleteId] || 0
    const value = msToHms(now - last)
    let columnIndex = null

    if (isGroupRelay(entry, label, teamAthletes)) {
      updateDraft(draftKey(entry.id, 'athlete', athleteId), value)
    } else {
      const sKey = draftKey(entry.id, 'segments', athleteId)
      const segments = segmentDrafts[sKey] ?? initialSegments(ea, entry)
      const columns = flattenColumns(segments)
      columnIndex = columns.findIndex((c) => !hasTime(segments[c.segIndex].repTimes[c.repIndex]))
      if (columnIndex !== -1) {
        const col = columns[columnIndex]
        updateSegmentDraft(sKey, updateSegmentRepTime(segments, col.segIndex, col.repIndex, value))
      } else {
        columnIndex = null
      }
    }

    setLastTapMs((prev) => ({ ...prev, [athleteId]: now }))
    setStopwatchTapVersion((v) => v + 1)
    return columnIndex
  }

  async function handleSaveEntry(entry) {
    setError('')
    setSavingEntryId(entry.id)
    try {
      const distance = parseEventDistance(entry.event_name) || { value: 1, unit: 'meters' }

      for (const [label, teamAthletes] of groupAthletesByTeam(entry.event_entry_athletes)) {
        const isRelay = isGroupRelay(entry, label, teamAthletes)

        if (isRelay) {
          const tKey = draftKey(entry.id, 'team', label)
          if (tKey in drafts) {
            await saveTeamResult({ entryId: entry.id, teamLabel: label || null, time: drafts[tKey] })
          }
        }

        for (const ea of teamAthletes) {
          const notes = `Meet result — ${event.name}${isRelay ? ' (relay leg)' : ''}`

          if (isRelay) {
            const iKey = draftKey(entry.id, 'athlete', ea.athlete_id)
            if (iKey in drafts) {
              const name = `${entry.event_name}${label ? ` (${label})` : ''} — Leg`
              await recordIndividualResult({
                entryId: entry.id,
                athleteId: ea.athlete_id,
                name,
                notes,
                segments: singleSegmentFromTime(drafts[iKey], distance),
              })
            }
          } else {
            const sKey = draftKey(entry.id, 'segments', ea.athlete_id)
            if (sKey in segmentDrafts) {
              await recordIndividualResult({
                entryId: entry.id,
                athleteId: ea.athlete_id,
                name: entry.event_name,
                notes,
                segments: segmentDrafts[sKey],
              })
            }
          }
        }
      }

      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingEntryId(null)
    }
  }

  async function handleClearTeam(entry, label) {
    setError('')
    setSavingEntryId(entry.id)
    try {
      await saveTeamResult({ entryId: entry.id, teamLabel: label || null, time: { hours: 0, minutes: 0, seconds: 0 } })
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingEntryId(null)
    }
  }

  async function handleClearAthlete(entry, athleteId) {
    setError('')
    setSavingEntryId(entry.id)
    try {
      await recordIndividualResult({ entryId: entry.id, athleteId, name: entry.event_name, notes: null, segments: [] })
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingEntryId(null)
    }
  }

  return (
    <div className="lineup-list">
      {error && <p className="form-error">{error}</p>}

      {entries.map((entry) => (
        <div key={entry.id} className="lineup-row result-entry-row">
          <div className="lineup-time">{formatTime(entry.scheduled_time)}</div>
          <div className="lineup-details">
            <div className="lineup-event-name">{entry.event_name}</div>

            {entry.event_entry_athletes.length > 0 && (
              <div className="stopwatch-panel">
                {activeStopwatchEntryId === entry.id ? (
                  <>
                    <div className="stopwatch-clock">{formatStopwatchClock(stopwatch.elapsedMs)}</div>
                    <p className="stopwatch-hint">Tap an athlete's name below to record their next split.</p>
                    <div className="stopwatch-actions">
                      <button type="button" onClick={handleFinishStopwatch}>
                        Finish Session
                      </button>
                      <button type="button" className="link-button danger" onClick={handleCancelStopwatch}>
                        Cancel Session
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => handleStartStopwatch(entry.id)}
                      disabled={activeStopwatchEntryId !== null}
                    >
                      Start Stopwatch
                    </button>
                    {activeStopwatchEntryId && activeStopwatchEntryId !== entry.id && (
                      <p className="stopwatch-blocked-hint">
                        Finish or cancel the stopwatch running for{' '}
                        {entries.find((e) => e.id === activeStopwatchEntryId)?.event_name || 'another event'} first.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {entry.event_entry_athletes.length === 0 ? (
              <p className="empty-state">No athletes assigned.</p>
            ) : (
              groupAthletesByTeam(entry.event_entry_athletes).map(([label, teamAthletes]) => {
                const gKey = groupKey(entry.id, label)
                const canBeRelay = teamAthletes.length > 1
                const isRelay = isGroupRelay(entry, label, teamAthletes)
                const teamResult = findTeamResult(entry, label)
                const teamKey = draftKey(entry.id, 'team', label)

                return (
                  <div className="result-group" key={label || 'default'}>
                    {label && <div className="lineup-team-label">{label}</div>}

                    {canBeRelay && (
                      <label className="result-relay-toggle">
                        <input
                          type="checkbox"
                          checked={isRelay}
                          onChange={(e) => setRelayOverrides((prev) => ({ ...prev, [gKey]: e.target.checked }))}
                        />
                        Relay squad (record a team result)
                      </label>
                    )}

                    {isRelay && (
                      <div className="result-row">
                        <span className="result-athlete-name">Team result</span>
                        <TimeTextInput
                          key={`${teamKey}-${resultsVersion}-${stopwatchTapVersion}`}
                          value={drafts[teamKey] ?? resultToTime(teamResult)}
                          onChange={(v) => updateDraft(teamKey, v)}
                          ariaLabel={`Team result for ${entry.event_name}${label ? ` ${label}` : ''}`}
                        />
                        {teamResult && (
                          <button type="button" className="link-button danger" onClick={() => handleClearTeam(entry, label)}>
                            Clear
                          </button>
                        )}
                      </div>
                    )}

                    {isRelay && <p className="result-hint">Individual leg splits (optional):</p>}

                    {isRelay ? (
                      teamAthletes.map((ea) => {
                        const saved = resultToTime(ea)
                        const iKey = draftKey(entry.id, 'athlete', ea.athlete_id)
                        const legActive = activeStopwatchEntryId === entry.id
                        const legDone = legActive && isAthleteStopwatchDone(entry, ea.athlete_id)
                        return (
                          <div className="result-row" key={ea.athlete_id}>
                            {legActive ? (
                              <button
                                type="button"
                                className={`result-athlete-name-tap${legDone ? ' result-athlete-name-tap-done' : ''}`}
                                onClick={() => handleStopwatchTap(entry, ea.athlete_id)}
                                disabled={legDone}
                              >
                                {ea.profiles?.name || 'Unnamed'}
                                {legDone && <span aria-hidden="true"> ✓</span>}
                              </button>
                            ) : (
                              <span className="result-athlete-name">{ea.profiles?.name || 'Unnamed'}</span>
                            )}
                            <TimeTextInput
                              key={`${iKey}-${resultsVersion}-${stopwatchTapVersion}`}
                              value={drafts[iKey] ?? saved}
                              onChange={(v) => updateDraft(iKey, v)}
                              ariaLabel={`Result for ${ea.profiles?.name || 'athlete'}`}
                            />
                            {!legActive && hasTime(saved) && (
                              <button
                                type="button"
                                className="link-button danger"
                                onClick={() => handleClearAthlete(entry, ea.athlete_id)}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <ResultSegmentsGrid
                        entry={entry}
                        athletes={teamAthletes}
                        segmentDrafts={segmentDrafts}
                        updateSegmentDraft={updateSegmentDraft}
                        draftKey={draftKey}
                        resultsVersion={resultsVersion}
                        stopwatchTapVersion={stopwatchTapVersion}
                        stopwatchActive={activeStopwatchEntryId === entry.id}
                        onStopwatchTap={(athleteId) => handleStopwatchTap(entry, athleteId)}
                        isStopwatchDone={(athleteId) => isAthleteStopwatchDone(entry, athleteId)}
                        onClear={handleClearAthlete}
                      />
                    )}
                  </div>
                )
              })
            )}
          </div>

          {entry.event_entry_athletes.length > 0 && (
            <div className="lineup-actions">
              <button type="button" onClick={() => handleSaveEntry(entry)} disabled={savingEntryId === entry.id}>
                {savingEntryId === entry.id ? 'Saving…' : 'Save results'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
