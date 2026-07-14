import TimeTextInput from './TimeTextInput'
import { calculatePace, distanceToMeters, hmsToSeconds, metersToMiles } from '../utils/format'

export const emptyRepTime = () => ({ hours: 0, minutes: 0, seconds: 0 })

export const emptySegment = () => ({
  key: crypto.randomUUID(),
  label: '',
  distanceValue: '',
  distanceUnit: 'miles',
  reps: 1,
  repTimes: [emptyRepTime()],
})

export default function RunningSegmentsEditor({ segments, onChange }) {
  function updateSegment(index, patch) {
    onChange(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  // Keep whatever the athlete typed (including a transient empty string)
  // rather than snapping back to a number on every keystroke — that snap-back
  // is what made the field impossible to clear. Only resize the repTimes
  // array once the text is actually a valid rep count.
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

  function updateRepTime(segIndex, repIndex, value) {
    const seg = segments[segIndex]
    const repTimes = seg.repTimes.map((t, i) => (i === repIndex ? value : t))
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
    onChange([...segments, emptySegment()])
  }

  return (
    <fieldset className="splits-fieldset">
      <legend>Segments</legend>
      <div className="segments-editor">
        {segments.map((seg, i) => {
          const distanceMiles = metersToMiles(distanceToMeters(seg.distanceValue, seg.distanceUnit))
          return (
            <div className="segment-editor-card" key={seg.key}>
              <div className="segment-editor-header">
                <span className="segment-index">{i + 1}</span>
                <input
                  type="text"
                  placeholder="Label (optional) — e.g. Warm up, Mile repeats"
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
                    <option value="meters">meters</option>
                    <option value="km">km</option>
                    <option value="miles">miles</option>
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
                  const pace = seconds > 0 ? calculatePace(distanceMiles, seconds) : null
                  return (
                    <div className="segment-rep-row" key={repIndex}>
                      {seg.reps > 1 && <span className="segment-rep-label">Rep {repIndex + 1}</span>}
                      <TimeTextInput
                        value={repTime}
                        onChange={(v) => updateRepTime(i, repIndex, v)}
                        ariaLabel={`Segment ${i + 1} rep ${repIndex + 1} time`}
                      />
                      <span className="segment-rep-pace">{pace || '—'}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" className="add-row" onClick={addSegment}>
        + Add segment
      </button>
    </fieldset>
  )
}
