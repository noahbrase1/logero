import SegmentEditor, { makeEmptySegment } from './SegmentEditor'

export const emptyAssignedBikeSegment = () => makeEmptySegment({ distanceUnit: 'miles' })

// Same pattern as AssignedSegmentsEditor/AssignedSwimSegmentsEditor — a
// separate target time per individual rep. No target watts/cadence fields:
// those are actuals-only, logged by the athlete, not something a coach
// assigns a target for.
export default function AssignedBikeSegmentsEditor({ segments, onChange }) {
  return (
    <SegmentEditor
      segments={segments}
      onChange={onChange}
      legend="Target segments"
      labelPlaceholder="Label (optional) — e.g. Warm up, Hill repeats"
      units={['miles', 'km']}
      distanceUnitDefault="miles"
    />
  )
}
