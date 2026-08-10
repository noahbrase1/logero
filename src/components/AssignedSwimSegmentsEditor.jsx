import SegmentEditor, { makeEmptySegment } from './SegmentEditor'

export const emptyAssignedSwimSegment = () => makeEmptySegment({ distanceUnit: 'yards' })

// Same pattern as AssignedSegmentsEditor (running) — a separate target time
// per individual rep, using the same entry form SwimSegmentsEditor uses for
// actuals.
export default function AssignedSwimSegmentsEditor({ segments, onChange }) {
  return (
    <SegmentEditor
      segments={segments}
      onChange={onChange}
      legend="Target segments"
      labelPlaceholder="Label (optional) — e.g. Warm up, Freestyle repeats"
      units={['yards', 'meters', 'miles']}
      distanceUnitDefault="yards"
      showSplitSheetToggle
    />
  )
}
