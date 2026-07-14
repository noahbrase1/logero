// Small stat tiles for dashboard-style pages — `stats`: [{ label, value }]
export default function StatRow({ stats }) {
  return (
    <div className="stat-row">
      {stats.map((s) => (
        <div className="stat-tile" key={s.label}>
          <div className="stat-tile-value">{s.value}</div>
          <div className="stat-tile-label">{s.label}</div>
        </div>
      ))}
    </div>
  )
}
