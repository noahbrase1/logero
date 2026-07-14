import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchAssignmentsForAthlete } from '../lib/assignments'
import { fetchWorkouts } from '../lib/workouts'
import { formatDate, workoutTypeLabel } from '../utils/format'
import TargetVsActual from '../components/TargetVsActual'
import { SkeletonList } from '../components/Skeleton'

export default function AthleteAssignmentsPage() {
  const { user } = useAuth()
  const [assignments, setAssignments] = useState([])
  const [workoutByAssignment, setWorkoutByAssignment] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([fetchAssignmentsForAthlete(user.id), fetchWorkouts({ userId: user.id })])
      .then(([assignmentData, workouts]) => {
        setAssignments(assignmentData)
        const map = {}
        workouts.forEach((w) => {
          if (w.assignment_id) map[w.assignment_id] = w
        })
        setWorkoutByAssignment(map)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [user.id])

  const todo = assignments.filter((a) => a.status === 'assigned')
  const completed = assignments.filter((a) => a.status === 'completed')

  return (
    <div className="page">
      <h1>Assigned workouts</h1>

      {loading && <SkeletonList count={3} />}
      {error && <p className="form-error">{error}</p>}

      {!loading && (
        <>
          <h2 className="events-section-heading">To do</h2>
          {todo.length === 0 && <p className="empty-state">Nothing assigned right now.</p>}
          <div className="assignments-list">
            {todo.map((a) => (
              <div key={a.id} className="assignment-card">
                <div className="assignment-card-header">
                  <div>
                    <span className={`type-badge type-${a.type}`}>{workoutTypeLabel(a.type)}</span>
                    <span className="workout-date">{formatDate(a.date)}</span>
                  </div>
                  <Link to={`/?assignmentId=${a.id}`}>
                    <button type="button">Log this workout</button>
                  </Link>
                </div>
                {a.notes && <p className="workout-notes">{a.notes}</p>}
                <TargetVsActual assignment={a} />
              </div>
            ))}
          </div>

          <h2 className="events-section-heading">Completed</h2>
          {completed.length === 0 && <p className="empty-state">No completed assignments yet.</p>}
          <div className="assignments-list">
            {completed.map((a) => (
              <div key={a.id} className="assignment-card">
                <div className="assignment-card-header">
                  <div>
                    <span className={`type-badge type-${a.type}`}>{workoutTypeLabel(a.type)}</span>
                    <span className="workout-date">{formatDate(a.date)}</span>
                  </div>
                  <span className="status-badge status-completed">completed</span>
                </div>
                {a.notes && <p className="workout-notes">{a.notes}</p>}
                <TargetVsActual assignment={a} workout={workoutByAssignment[a.id]} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
