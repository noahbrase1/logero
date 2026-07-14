import TimeTextInput from './TimeTextInput'

export const emptyAssignedBikeSegment = () => ({
  key: crypto.randomUUID(),
  label: '',
  distanceValue: '',
  distanceUnit: 'miles',
  reps: 1,
  targetTime: { hours: 0, minutes: 0, seconds: 0 },
})

// Same pattern as AssignedSegmentsEditor/AssignedSwimSegmentsEditor — one
// target time per segment (applies to each rep). No target watts/cadence:
// those are actuals-only fields an athlete logs, not something a coach
// assigns a target for.
export default function AssignedBikeSegmentsEditor({ segments, onChange }) {
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
    onChange([...segments, emptyAssignedBikeSegment()])
  }

  return (
    <fieldset className="splits-fieldset">
      <legend>Target segments</legend>
      <div className="segments-editor">
        {segments.map((seg, i) => (
          <div className="segment-editor-card" key={seg.key}>
            <div className="segment-editor-header">
              <span className="segment-index">{i + 1}</span>
              <input
                type="text"
                placeholder="Label (optional) — e.g. Warm up, Hill repeats"
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
                  <option value="km">km</option>
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
