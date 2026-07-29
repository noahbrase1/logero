import SegmentEditor, { makeEmptySegment } from './SegmentEditor'

const BIKE_REP_EXTRA_FIELDS = { avgWatts: '', avgCadence: '' }

export const emptyBikeSegment = () => makeEmptySegment({ distanceUnit: 'miles', extraRepFields: BIKE_REP_EXTRA_FIELDS })

// Same segment-builder pattern as RunningSegmentsEditor/SwimSegmentsEditor,
// with two extra OPTIONAL fields per rep — avg watts and avg cadence — for
// athletes with a power meter/cadence sensor. Left blank, they're simply
// omitted from the logged rep (see WorkoutCard's BikeSegmentSummary).
export default function BikeSegmentsEditor({ segments, onChange }) {
  return (
    <SegmentEditor
      segments={segments}
      onChange={onChange}
      legend="Segments"
      labelPlaceholder="Label (optional) — e.g. Warm up, Hill repeats"
      units={['miles', 'km']}
      distanceUnitDefault="miles"
      repExtraFields={[
        { key: 'avgWatts', placeholder: 'Avg watts' },
        { key: 'avgCadence', placeholder: 'Avg cadence' },
      ]}
    />
  )
}
