import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchProfile, fetchWorkouts } from '../lib/workouts'
import { fetchEvents } from '../lib/events'
import { fetchAssignmentsForAthlete } from '../lib/assignments'
import EventCalendar from '../components/EventCalendar'

// Read-only view of one athlete's own calendar (assigned + logged workouts
// by date, same as what the athlete sees on their own Calendar tab) —
// reachable from AthleteDetailPage so a coach/admin doesn't have to
// reconstruct a day-by-day picture from the flat workout history list.
// `canLog`/`isCoach` are left false/false and no event edit handlers are
// passed to EventCalendar, so nothing here is editable even though the
// viewer may be a coach.
export default function AthleteCalendarPage() {
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [events, setEvents] = useState([])
  const [assignments, setAssignments] = useState([])
  const [workoutByAssignment, setWorkoutByAssignment] = useState({})
  const [workoutsByDate, setWorkoutsByDate] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    Promise.all([fetchProfile(id), fetchEvents(), fetchAssignmentsForAthlete(id), fetchWorkouts({ userId: id })])
      .then(([profileData, eventData, assignmentData, workouts]) => {
        setProfile(profileData)
        setEvents(eventData)
        setAssignments(assignmentData)
        const map = {}
        const byDate = {}
        workouts.forEach((w) => {
          if (w.assignment_id) map[w.assignment_id] = w
          byDate[w.date] = w
        })
        setWorkoutByAssignment(map)
        setWorkoutsByDate(byDate)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (error) return <div className="page form-error">{error}</div>
  if (loading || !profile) {
    return (
      <div className="page loading-state">
        <span className="spinner" /> Loading calendar…
      </div>
    )
  }

  const isRemoved = profile.role === 'removed'

  return (
    <div className="page">
      <div className="page-header-row">
        <h1>{profile.name || 'Athlete'}'s calendar</h1>
        <Link to={`/athletes/${id}`} className="link-button">
          ← Back to {isRemoved ? 'former athlete' : "athlete's"} workouts
        </Link>
      </div>
      <p className="form-info">Read-only — this is the same calendar {profile.name || 'the athlete'} sees themselves.</p>
      <EventCalendar
        events={events}
        assignments={assignments}
        workoutByAssignment={workoutByAssignment}
        workoutsByDate={workoutsByDate}
        canLog={false}
        showAthleteData
        isCoach={false}
      />
    </div>
  )
}
