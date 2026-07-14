import WorkoutCard from './WorkoutCard'
import QuickNoteCard from './QuickNoteCard'

export default function WorkoutListItem({ workout, showAthleteName = false }) {
  if (workout.type === 'note') {
    return <QuickNoteCard note={workout} showAthleteName={showAthleteName} />
  }
  return <WorkoutCard workout={workout} showAthleteName={showAthleteName} />
}
