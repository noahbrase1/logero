import SegmentEditor, { makeEmptySegment } from './SegmentEditor'

export const emptySegment = () => makeEmptySegment({ distanceUnit: 'miles' })

// Mirrors RunningSegmentsEditor exactly, except the unit dropdown is wider
// (cross-training activities span more units than running does — a rower in
// meters, a sled push in feet).
export default function OtherSegmentsEditor({ segments, onChange }) {
  return (
    <SegmentEditor
      segments={segments}
      onChange={onChange}
      legend="Segments"
      labelPlaceholder="Label (optional) — e.g. Warm up, Intervals"
      units={['miles', 'meters', 'km', 'feet', 'yards']}
      distanceUnitDefault="miles"
      showPace
    />
  )
}
