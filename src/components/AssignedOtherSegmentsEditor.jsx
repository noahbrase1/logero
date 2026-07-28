import TimeTextInput from './TimeTextInput'
import { hmsToSeconds, secondsToClock } from '../utils/format'

export const emptyAssignedOtherSegment = () => ({
  key: crypto.randomUUID(),
  label: '',
  distanceValue: '',
  distanceUnit: 'miles',
  reps: 1,
  targetTime: { hours: 0, minutes: 0, seconds: 0 },
})

// Mirrors AssignedSegmentsEditor (running's target-segment editor) exactly,
// except the unit dropdown is wider — same reasoning as OtherSegmentsEditor.
// No pace shown for the target time (unlike running's formatTargetPace) —
// just the raw target time, same treatment swim/bike targets already get.
export default function AssignedOtherSegmentsEditor({ segments, onChange }) {
  function updateSegment(index, patch) {
    onChange(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)))
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
    onChange([...segments, emptyAssignedOtherSegment()])
  }

  return (
    <fieldset className="splits-fieldset">
      <legend>Target segments</legend>
      <div className="segments-editor">
        {segments.map((seg, i) => {
          const targetSeconds = hmsToSeconds(seg.targetTime)

          return (
            <div className="segment-editor-card" key={seg.key}>
              <div className="segment-editor-header">
                <span className="segment-index">{i + 1}</span>
                <input
                  type="text"
                  placeholder="Label (optional) — e.g. Warm up, Intervals"
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
                    <option value="miles">miles</option>
                    <option value="meters">meters</option>
                    <option value="km">km</option>
                    <option value="feet">feet</option>
                    <option value="yards">yards</option>
                  </select>
                </label>
                <label>
                  Reps
                  <input
                    type="number"
                    min="1"
                    value={seg.reps}
                    onChange={(e) => updateSegment(i, { reps: e.target.value })}
                  />
                </label>
                <label>
                  Target time {seg.reps > 1 ? '(per rep)' : ''}
                  <TimeTextInput
                    value={seg.targetTime}
                    onChange={(v) => updateSegment(i, { targetTime: v })}
                    ariaLabel={`Segment ${i + 1} target time`}
                  />
                </label>
                <span className="segment-rep-pace">{targetSeconds > 0 ? secondsToClock(targetSeconds) : ''}</span>
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
