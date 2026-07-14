import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchWorkouts } from '../lib/workouts'
import WorkoutListItem from '../components/WorkoutListItem'
import StatRow from '../components/StatRow'
import { SkeletonList } from '../components/Skeleton'

export default function WorkoutHistoryPage({ userId, title = 'Workout history', showAthleteName = false }) {
  const { user } = useAuth()
  const targetUserId = userId || user.id

  const [type, setType] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [workouts, setWorkouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetchWorkouts({ userId: targetUserId, type: type || undefined, startDate: startDate || undefined, endDate: endDate || undefined })
      .then((data) => {
        if (!cancelled) setWorkouts(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [targetUserId, type, startDate, endDate])

  const stats = useMemo(() => {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const weekAgoStr = weekAgo.toISOString().slice(0, 10)
    return [
      { label: 'Total logged', value: workouts.length },
      { label: 'This week', value: workouts.filter((w) => w.date >= weekAgoStr).length },
    ]
  }, [workouts])

  const filtersActive = type || startDate || endDate

  return (
    <div className="page">
      <h1>{title}</h1>

      <div className="filter-bar">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            <option value="running">Running</option>
            <option value="swim">Swimming</option>
            <option value="bike">Cycling</option>
            <option value="lifting">Lifting</option>
            <option value="note">Notes</option>
          </select>
        </label>
        <label>
          From
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        {filtersActive && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setType('')
              setStartDate('')
              setEndDate('')
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {!loading && !error && workouts.length > 0 && <StatRow stats={stats} />}

      {loading && <SkeletonList count={4} />}
      {error && <p className="form-error">{error}</p>}
      {!loading && !error && workouts.length === 0 && (
        <p className="empty-state">
          {filtersActive ? 'No workouts match these filters.' : 'No workouts logged yet — get started above.'}
        </p>
      )}

      <div className="workout-list">
        {workouts.map((w) => (
          <WorkoutListItem key={w.id} workout={w} showAthleteName={showAthleteName} />
        ))}
      </div>
    </div>
  )
}
