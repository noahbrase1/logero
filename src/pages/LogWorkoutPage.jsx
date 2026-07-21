import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import LogWorkoutForm from '../components/LogWorkoutForm'

// Thin route wrapper around LogWorkoutForm — kept at /log and /edit/:workoutId
// as a plain URL fallback (not linked from nav anywhere; the calendar opens
// LogWorkoutForm directly in a modal instead, with no route change at all).
// Reads the same assignmentId/date prefill query params LogWorkoutForm used
// to read itself, and just navigates home when done since there's no
// "close the modal" to fall back to here.
export default function LogWorkoutPage() {
  const { workoutId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  return (
    <div className="page">
      <LogWorkoutForm
        workoutId={workoutId}
        initialAssignmentId={searchParams.get('assignmentId')}
        initialDate={searchParams.get('date')}
        onSaved={() => navigate('/')}
        onCancel={() => navigate('/')}
      />
    </div>
  )
}
