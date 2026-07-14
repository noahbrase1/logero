import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchProfile } from '../lib/workouts'
import WorkoutHistoryPage from './WorkoutHistoryPage'

export default function AthleteDetailPage() {
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setProfile(null)
    fetchProfile(id)
      .then(setProfile)
      .catch((err) => setError(err.message))
  }, [id])

  if (error) return <div className="page form-error">{error}</div>
  if (!profile) {
    return (
      <div className="page loading-state">
        <span className="spinner" /> Loading athlete…
      </div>
    )
  }

  const isRemoved = profile.role === 'removed'

  return (
    <div>
      <div className="page">
        <Link to={isRemoved ? '/former-athletes' : '/roster'} className="link-button">
          {isRemoved ? '← Back to former athletes' : '← Back to roster'}
        </Link>
      </div>
      <WorkoutHistoryPage userId={id} title={`${profile.name || 'Athlete'}'s workouts`} />
    </div>
  )
}
