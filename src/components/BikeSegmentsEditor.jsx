import TimeTextInput from './TimeTextInput'

export const emptyBikeRep = () => ({ hours: 0, minutes: 0, seconds: 0, avgWatts: '', avgCadence: '' })

export const emptyBikeSegment = () => ({
  key: crypto.randomUUID(),
  label: '',
  distanceValue: '',
  distanceUnit: 'miles',
  reps: 1,
  repTimes: [emptyBikeRep()],
})

// Same segment-builder pattern as RunningSegmentsEditor/SwimSegmentsEditor,
// with two extra OPTIONAL fields per rep — avg watts and avg cadence — for
// athletes with a power meter/cadence sensor. Left blank, they're simply
// omitted from the logged rep (see WorkoutCard's BikeSegmentSummary).
export default function BikeSegmentsEditor({ segments, onChange }) {
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

    const repTimes = Array.from({ length: parsed }, (_, i) => seg.repTimes[i] || emptyBikeRep())
    updateSegment(index, { reps: rawReps, repTimes })
  }

  // TimeTextInput only ever hands back {hours,minutes,seconds} — merge it in
  // rather than replacing the rep outright, so avgWatts/avgCadence survive.
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
    onChange([...segments, emptyBikeSegment()])
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
                  <input
                    type="number"
                    min="0"
                    placeholder="Avg watts"
                    aria-label={`Segment ${i + 1} rep ${repIndex + 1} avg watts`}
                    className="bike-rep-optional-input"
                    value={repTime.avgWatts}
                    onChange={(e) => updateRepField(i, repIndex, 'avgWatts', e.target.value)}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Avg cadence"
                    aria-label={`Segment ${i + 1} rep ${repIndex + 1} avg cadence`}
                    className="bike-rep-optional-input"
                    value={repTime.avgCadence}
                    onChange={(e) => updateRepField(i, repIndex, 'avgCadence', e.target.value)}
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
