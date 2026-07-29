import TimeTextInput from './TimeTextInput'
import { formatTargetPace, hmsToSeconds } from '../utils/format'

export const emptyRepTime = (extraFields = {}) => ({ hours: 0, minutes: 0, seconds: 0, ...extraFields })

// A segment's shape never differs between athlete logging (actual times)
// and coach assigning (target times) — { label, distanceValue, distanceUnit,
// reps, repTimes: [...] } either way. `extraRepFields` seeds any optional
// per-rep fields beyond hours/minutes/seconds (bike's avgWatts/avgCadence).
export function makeEmptySegment({ distanceUnit, extraRepFields } = {}) {
  return {
    key: crypto.randomUUID(),
    label: '',
    distanceValue: '',
    distanceUnit,
    reps: 1,
    repTimes: [emptyRepTime(extraRepFields)],
  }
}

// The one segment/rep entry form used identically for athlete logging and
// coach assigning, across running, swim, bike, and other — see
// RunningSegmentsEditor.jsx/AssignedSegmentsEditor.jsx etc. for the thin,
// per-type wrappers around this that LogWorkoutForm/AssignmentForm actually
// import (kept as separate files/exports so neither of those callers needed
// to change, not because the underlying logic differs).
//
// `units`: the distance-unit options to offer (varies per sport). `showPace`
// (running only): renders a live per-rep pace/time preview using
// formatTargetPace — reused here for actuals too, not just targets, since
// the "raw time for an interval, converted mile-pace for a single continuous
// distance" logic it already encodes is exactly as correct for a logged rep
// as for a target one; there's no reason those should read differently.
// `repExtraFields`: optional per-rep inputs beyond the time itself (bike's
// avg watts/cadence — logging only, since a coach doesn't assign a target
// for those).
export default function SegmentEditor({
  segments,
  onChange,
  legend,
  labelPlaceholder,
  units,
  distanceUnitDefault,
  showPace = false,
  repExtraFields = [],
}) {
  function updateSegment(index, patch) {
    onChange(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  // Keeps whatever was typed (including a transient empty string) rather
  // than snapping back to a number on every keystroke — that snap-back is
  // what made the field impossible to clear. Only resizes repTimes once the
  // text is actually a valid rep count.
  function updateReps(index, rawReps) {
    const seg = segments[index]
    const parsed = Number(rawReps)
    const isValidCount = rawReps !== '' && Number.isInteger(parsed) && parsed >= 1

    if (!isValidCount) {
      updateSegment(index, { reps: rawReps })
      return
    }

    const repTimes = Array.from({ length: parsed }, (_, i) => seg.repTimes[i] || emptyRepTime())
    updateSegment(index, { reps: rawReps, repTimes })
  }

  // TimeTextInput only ever hands back {hours,minutes,seconds} — merge it
  // in rather than replacing the rep outright, so any repExtraFields values
  // survive.
  function updateRepTime(segIndex, repIndex, timeValue) {
    const seg = segments[segIndex]
    const repTimes = seg.repTimes.map((t, i) => (i === repIndex ? { ...t, ...timeValue } : t))
    updateSegment(segIndex, { repTimes })
  }

  function updateRepField(segIndex, repIndex, field, value) {
    const seg = segments[segIndex]
    const repTimes = seg.repTimes.map((t, i) => (i === repIndex ? { ...t, [field]: value } : t))
    updateSegment(segIndex, { repTimes })
  }

  function removeSegment(index) {
    onChange(segments.filter((_, i) => i !== index))
  }

  function moveSegment(index, direction) {
    const target = index + direction
    if (target < 0 || target >= segments.length) return
    const next = [...segments]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  function addSegment() {
    onChange([...segments, makeEmptySegment({ distanceUnit: distanceUnitDefault })])
  }

  return (
    <fieldset className="splits-fieldset">
      <legend>{legend}</legend>
      <div className="segments-editor">
        {segments.map((seg, i) => (
          <div className="segment-editor-card" key={seg.key}>
            <div className="segment-editor-header">
              <span className="segment-index">{i + 1}</span>
              <input
                type="text"
                placeholder={labelPlaceholder}
                value={seg.label}
                onChange={(e) => updateSegment(i, { label: e.target.value })}
                className="segment-label-input"
              />
              <div className="segment-editor-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => moveSegment(i, -1)}
                  disabled={i === 0}
                  aria-label="Move segment up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => moveSegment(i, 1)}
                  disabled={i === segments.length - 1}
                  aria-label="Move segment down"
                >
                  ↓
                </button>
                {segments.length > 1 && (
                  <button
                    type="button"
                    className="remove-row"
                    onClick={() => removeSegment(i)}
                    aria-label="Remove segment"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <div className="form-row">
              <label>
                Distance
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={seg.distanceValue}
                  onChange={(e) => updateSegment(i, { distanceValue: e.target.value })}
                />
              </label>
              <label>
                Unit
                <select value={seg.distanceUnit} onChange={(e) => updateSegment(i, { distanceUnit: e.target.value })}>
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reps
                <input type="number" min="1" value={seg.reps} onChange={(e) => updateReps(i, e.target.value)} />
              </label>
            </div>

            <div className="segment-reps">
              {seg.repTimes.map((repTime, repIndex) => {
                const seconds = hmsToSeconds(repTime)
                const pace =
                  showPace && seconds > 0
                    ? formatTargetPace(seg.distanceValue, seg.distanceUnit, Number(seg.reps) || 1, seconds)
                    : null

                return (
                  <div className="segment-rep-row" key={repIndex}>
                    {seg.reps > 1 && <span className="segment-rep-label">Rep {repIndex + 1}</span>}
                    <TimeTextInput
                      value={repTime}
                      onChange={(v) => updateRepTime(i, repIndex, v)}
                      ariaLabel={`Segment ${i + 1} rep ${repIndex + 1} time`}
                    />
                    {showPace && <span className="segment-rep-pace">{pace || '—'}</span>}
                    {repExtraFields.map((field) => (
                      <input
                        key={field.key}
                        type="number"
                        min="0"
                        placeholder={field.placeholder}
                        aria-label={`Segment ${i + 1} rep ${repIndex + 1} ${field.placeholder}`}
                        className="bike-rep-optional-input"
                        value={repTime[field.key]}
                        onChange={(e) => updateRepField(i, repIndex, field.key, e.target.value)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="add-row" onClick={addSegment}>
        + Add segment
      </button>
    </fieldset>
  )
}
