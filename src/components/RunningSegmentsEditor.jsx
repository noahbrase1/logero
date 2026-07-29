import SegmentEditor, { makeEmptySegment } from './SegmentEditor'

export const emptySegment = () => makeEmptySegment({ distanceUnit: 'miles' })

export default function RunningSegmentsEditor({ segments, onChange }) {
  return (
    <SegmentEditor
      segments={segments}
      onChange={onChange}
      legend="Segments"
      labelPlaceholder="Label (optional) — e.g. Warm up, Mile repeats"
      units={['meters', 'km', 'miles']}
      distanceUnitDefault="miles"
      showPace
    />
  )
}
