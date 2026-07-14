import { IconBike, IconDumbbell, IconPencil, IconRun, IconSwimming } from '@tabler/icons-react'

const ICONS_BY_TYPE = {
  running: IconRun,
  swim: IconSwimming,
  bike: IconBike,
  lifting: IconDumbbell,
  note: IconPencil,
}

// Fixed sport-type icon, colored via the `type-{type}` CSS class (see
// index.css "Sport-type colors" — these colors are intentionally NOT part
// of the team's customizable theme, so the same icon+color always means the
// same sport everywhere a workout card appears).
export default function WorkoutTypeIcon({ type, size = 18 }) {
  const Icon = ICONS_BY_TYPE[type]
  if (!Icon) return null
  return <Icon size={size} className={`workout-type-icon type-${type}`} stroke={2} aria-hidden="true" />
}
