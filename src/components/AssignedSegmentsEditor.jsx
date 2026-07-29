import SegmentEditor, { makeEmptySegment } from './SegmentEditor'

export const emptyAssignedSegment = () => makeEmptySegment({ distanceUnit: 'miles' })

// Lets a coach build a multi-segment target workout the same way an athlete
// builds a log — a separate target time per individual rep (e.g. a 4x800m
// segment gets 4 distinct target times), using the exact same entry form
// RunningSegmentsEditor uses for actuals (see SegmentEditor.jsx).
export default function AssignedSegmentsEditor({ segments, onChange }) {
  return (
    <SegmentEditor
      segments={segments}
      onChange={onChange}
      legend="Target segments"
      labelPlaceholder="Label (optional) — e.g. Warm up, Mile repeats"
      units={['meters', 'km', 'miles']}
      distanceUnitDefault="miles"
      showPace
    />
  )
}
