// Bold colored dashboard-header stats — `metrics`: [{ key, label, value }].
// `key` selects a fixed color via the `metric-card-{key}` CSS class (see
// index.css), not the plain neutral style StatRow uses elsewhere. Keep this
// to 2-3 metrics so the header doesn't get busy.
export default function MetricCardRow({ metrics }) {
  return (
    <div className="metric-card-row">
      {metrics.map((m) => (
        <div className={`metric-card metric-card-${m.key}`} key={m.key}>
          <div className="metric-card-label">{m.label}</div>
          <div className="metric-card-value">{m.value}</div>
        </div>
      ))}
    </div>
  )
}
