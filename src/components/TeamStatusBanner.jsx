import { useAuth } from '../context/AuthContext'

export default function TeamStatusBanner() {
  const { teamStatus } = useAuth()

  if (teamStatus === 'pending') {
    return (
      <div className="team-status-banner pending">
        Your team is awaiting approval — you can explore and set things up, but athletes, coaches, and admins you
        invite won't have access until approval is complete.
      </div>
    )
  }

  if (teamStatus === 'rejected') {
    return (
      <div className="team-status-banner rejected">
        Your team was not approved. Your account and its data are kept, but the team can no longer log workouts,
        message, or make roster changes.
      </div>
    )
  }

  return null
}
