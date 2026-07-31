// First legend/color-key component in the app — explains the calendar's
// two dot families (see EventCalendar's per-day indicators): a workout dot
// per sport type (same fixed colors used everywhere else in the app, via
// WorkoutTypeIcon/.type-badge) and an event dot per category (new, see
// event_categories_schema.sql). Kept as two small grouped clusters rather
// than merging the two dot systems into one flat list, since both
// families happen to have an "Other" entry with a different meaning.
const WORKOUT_TYPES = [
  { type: 'running', label: 'Running' },
  { type: 'swim', label: 'Swimming' },
  { type: 'bike', label: 'Cycling' },
  { type: 'lifting', label: 'Lifting' },
  { type: 'other', label: 'Other' },
]

const EVENT_CATEGORIES = [
  { category: 'meet', label: 'Meet' },
  { category: 'team_event', label: 'Team event' },
  { category: 'other', label: 'Other' },
]

export default function CalendarLegend() {
  return (
    <div className="calendar-legend">
      <div className="calendar-legend-group">
        <span className="calendar-legend-group-label">Workouts</span>
        {WORKOUT_TYPES.map(({ type, label }) => (
          <span className="calendar-legend-item" key={type}>
            <span className={`calendar-legend-dot type-${type}`} />
            {label}
          </span>
        ))}
      </div>
      <div className="calendar-legend-group">
        <span className="calendar-legend-group-label">Events</span>
        {EVENT_CATEGORIES.map(({ category, label }) => (
          <span className="calendar-legend-item" key={category}>
            <span className={`calendar-legend-dot cat-${category}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
