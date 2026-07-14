// Shared name/date/time/location/notes fields for both creating an event
// (EventsPage's top form) and editing one inline (EventCard, in place of
// the card's normal display) — same fields, same shape, just rendered in
// different spots by the caller.
export default function EventForm({ form, setForm, onSubmit, onCancel, saving, error, submitLabel }) {
  return (
    <form className="workout-form event-form" onSubmit={onSubmit}>
      <div className="form-row">
        <label>
          Event name
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Regional Championships"
            required
          />
        </label>
        <label>
          Date
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            required
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Start time (optional)
          <input
            type="time"
            value={form.startTime}
            onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
          />
        </label>
        <label>
          End time (optional)
          <input
            type="time"
            value={form.endTime}
            onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Location
          <input
            type="text"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="City Stadium"
          />
        </label>
      </div>
      <label>
        Notes
        <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-row">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
