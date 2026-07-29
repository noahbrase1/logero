import SegmentEditor, { makeEmptySegment } from './SegmentEditor'

export const emptyAssignedOtherSegment = () => makeEmptySegment({ distanceUnit: 'miles' })

// Mirrors AssignedSegmentsEditor (running's target-segment editor) exactly,
// except the unit dropdown is wider — same reasoning as OtherSegmentsEditor.
export default function AssignedOtherSegmentsEditor({ segments, onChange }) {
  return (
    <SegmentEditor
      segments={segments}
      onChange={onChange}
      legend="Target segments"
      labelPlaceholder="Label (optional) — e.g. Warm up, Intervals"
      units={['miles', 'meters', 'km', 'feet', 'yards']}
      distanceUnitDefault="miles"
      showPace
    />
  )
}
