import { useState } from 'react'
import { formatTimeForInput, parseTimeInput } from '../utils/format'

// Single free-text time field: "58" -> 58s, "6:45" -> 6m45s, "1:06:45" ->
// 1h6m45s, parsed right-to-left. Validates live; a lone trailing colon
// (still mid-typing the next group) is treated as "not ready yet" rather
// than an error. `value`/`onChange` carry the parsed {hours,minutes,seconds}
// — the parent only ever sees valid values.
export default function TimeTextInput({ value, onChange, ariaLabel, placeholder = 'e.g. 6:45' }) {
  const [text, setText] = useState(() => formatTimeForInput(value))
  const [error, setError] = useState('')

  function handleChange(raw) {
    setText(raw)
    const trimmed = raw.trim()

    if (trimmed === '') {
      setError('')
      onChange({ hours: 0, minutes: 0, seconds: 0 })
      return
    }

    if (/:$/.test(trimmed)) {
      // Still typing the next segment (e.g. "6:") — don't flag an error yet.
      setError('')
      return
    }

    try {
      const parsed = parseTimeInput(trimmed)
      setError('')
      onChange(parsed)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <span className="time-text-input">
      <input
        type="text"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? 'true' : 'false'}
        className={error ? 'input-invalid' : ''}
      />
      {error && <span className="time-text-error">{error}</span>}
    </span>
  )
}
