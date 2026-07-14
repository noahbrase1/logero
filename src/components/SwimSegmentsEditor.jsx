import TimeTextInput from './TimeTextInput'

export const emptyRepTime = () => ({ hours: 0, minutes: 0, seconds: 0 })

export const emptySwimSegment = () => ({
  key: crypto.randomUUID(),
  label: '',
  distanceValue: '',
  distanceUnit: 'yards',
  reps: 1,
  repTimes: [emptyRepTime()],
})

// Same segment-builder pattern as RunningSegmentsEditor — a swim workout
// like "4 x 100m freestyle, 2 x 200m IM" is built the same way a running
// workout builds warm-up + intervals. No pace column: unlike running, a
// swim segment's meaningful summary is just its times (see WorkoutCard).
export default function SwimSegmentsEditor({ segments, onChange }) {
  function updateSegment(index, patch) {
    onChange(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  // See RunningSegmentsEditor for why this keeps the raw text during typing
  // instead of snapping back to a number on every keystroke.
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
    onChange([...segments, emptySwimSegment()])
  }

  return (
    <fieldset className="splits-fieldset">
      <legend>Segments</legend>
      <div className="segments-editor">
        {segments.map((seg, i) => (
          <div className="segment-editor-card" key={seg.key}>
            <div className="segment-editor-header">
              <span className="segment-index">{i + 1}</span>
              <input
                type="text"
                placeholder="Label (optional) — e.g. Warm up, Freestyle repeats"
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
                  <option value="yards">yards</option>
                  <option value="meters">meters</option>
                  <option value="miles">miles</option>
                </select>
              </label>
              <label>
                Reps
                <input type="number" min="1" value={seg.reps} onChange={(e) => updateReps(i, e.target.value)} />
              </label>
            </div>

            <div className="segment-reps">
              {seg.repTimes.map((repTime, repIndex) => (
                <div className="segment-rep-row" key={repIndex}>
                  {seg.reps > 1 && <span className="segment-rep-label">Rep {repIndex + 1}</span>}
                  <TimeTextInput
                    value={repTime}
                    onChange={(v) => updateRepTime(i, repIndex, v)}
                    ariaLabel={`Segment ${i + 1} rep ${repIndex + 1} time`}
                  />
                </div>
              ))}
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
