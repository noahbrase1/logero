import SegmentEditor, { makeEmptySegment } from './SegmentEditor'

export const emptySwimSegment = () => makeEmptySegment({ distanceUnit: 'yards' })

// A swim workout like "4 x 100m freestyle, 2 x 200m IM" is built the same
// way a running workout builds warm-up + intervals. No pace column: unlike
// running, a swim segment's meaningful summary is just its times (see
// WorkoutCard).
export default function SwimSegmentsEditor({ segments, onChange }) {
  return (
    <SegmentEditor
      segments={segments}
      onChange={onChange}
      legend="Segments"
      labelPlaceholder="Label (optional) — e.g. Warm up, Freestyle repeats"
      units={['yards', 'meters', 'miles']}
      distanceUnitDefault="yards"
    />
  )
}
