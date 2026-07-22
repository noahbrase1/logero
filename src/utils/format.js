// Duration is stored/entered as total seconds; distance is in miles.

export function secondsToClock(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return ''
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

// Returns pace as "m:ss /mi" given distance (miles) and duration (seconds).
export function calculatePace(distance, durationSeconds) {
  const dist = Number(distance)
  const dur = Number(durationSeconds)
  if (!dist || dist <= 0 || !dur || dur <= 0) return null
  const paceSeconds = dur / dist
  return `${secondsToClock(paceSeconds)} /mi`
}

// Target pace/time for a running segment, shown to both the coach (while
// assigning) and the athlete (in TargetVsActual). A single continuous
// distance (reps <= 1, e.g. a 5-mile run) converts to a per-mile pace like
// "6:24 /mi" — but a repeated/interval segment (reps > 1, e.g. 4x800m)
// shows the raw per-rep target time against its own distance instead, e.g.
// "2:22/800m" — converting an interval's short per-rep distance into a
// full-mile pace produces a misleadingly large, meaningless number.
export function formatTargetPace(distanceValue, distanceUnit, reps, targetSeconds) {
  if (!targetSeconds || targetSeconds <= 0) return null
  if (reps > 1) {
    return `${secondsToClock(targetSeconds)}/${formatDistanceValue(distanceValue, distanceUnit)}${unitAbbrev(distanceUnit)}`
  }
  return calculatePace(metersToMiles(distanceToMeters(distanceValue, distanceUnit)), targetSeconds)
}

export function formatDate(dateStr) {
  if (!dateStr) return ''
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// Full "Monday, July 6" style heading used for the date-grouped feed.
export function formatDateHeading(dateStr) {
  if (!dateStr) return ''
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// Formats a Postgres `time` value ("14:30:00") as "2:30 PM". Returns a
// placeholder for unscheduled entries so they still sort/display predictably.
export function formatTime(timeStr) {
  if (!timeStr) return 'TBD'
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// "9:00 AM to 2:00 PM" / "9:00 AM" (start only) / "" (neither set — an
// all-day or time-TBD event, distinct from formatTime's own 'TBD' fallback
// which is for event_entries.scheduled_time, a field that's always
// meaningful to show even when unset).
export function formatTimeRange(startTime, endTime) {
  if (!startTime && !endTime) return ''
  if (startTime && endTime) return `${formatTime(startTime)} to ${formatTime(endTime)}`
  return formatTime(startTime || endTime)
}

// --- Segment time (h/m/s object) <-> seconds ---

export function hmsToSeconds({ hours = 0, minutes = 0, seconds = 0 } = {}) {
  const h = Number(hours) || 0
  const m = Number(minutes) || 0
  const s = Number(seconds) || 0
  return h * 3600 + m * 60 + s
}

export function secondsToHms(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0))
  return {
    hours: Math.floor(s / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  }
}

// --- Distance unit conversion ---

const METERS_PER_MILE = 1609.344

const METERS_PER_YARD = 0.9144

export function distanceToMeters(value, unit) {
  const v = Number(value)
  if (!v || v <= 0) return 0
  if (unit === 'km') return v * 1000
  if (unit === 'miles') return v * METERS_PER_MILE
  if (unit === 'yards') return v * METERS_PER_YARD
  return v // meters
}

export function metersToMiles(meters) {
  return (Number(meters) || 0) / METERS_PER_MILE
}

export function unitAbbrev(unit) {
  if (unit === 'meters') return 'm'
  if (unit === 'km') return 'km'
  if (unit === 'yards') return 'yd'
  return 'mi'
}

// Display-only rounding to the nearest 0.1 mile — never applied to a value
// before it's stored, only at the point a miles figure is rendered as text.
export function roundMiles(miles) {
  return Math.round((Number(miles) || 0) * 10) / 10
}

// A distance value as it should be *displayed*: rounded to the nearest 0.1
// when its unit is miles (the one unit prone to long decimals from mileage
// math/conversion), shown exactly as entered/stored otherwise (meters/km/
// yards aren't subject to this rounding).
export function formatDistanceValue(value, unit) {
  return unit === 'miles' ? roundMiles(value) : value
}

// Display label + badge/toggle text for a workouts.type value, shared across
// LogWorkoutForm, WorkoutCard, CoachAssignmentsPage, EventCalendar.
export const WORKOUT_TYPE_LABELS = {
  running: 'Running',
  swim: 'Swimming',
  bike: 'Cycling',
  lifting: 'Lifting',
  note: 'Note',
}

export function workoutTypeLabel(type) {
  return WORKOUT_TYPE_LABELS[type] || type
}

// --- Flexible single-field time entry: "58" / "6:45" / "1:06:45", parsed
// right-to-left (rightmost group is always seconds). Throws with a
// user-facing message on anything unrecognized.

export function parseTimeInput(input) {
  const trimmed = String(input ?? '').trim()
  if (trimmed === '') return { hours: 0, minutes: 0, seconds: 0 }
  if (!/^\d+(:\d+){0,2}$/.test(trimmed)) {
    throw new Error('Enter a time like 58, 6:45, or 1:06:45')
  }

  const parts = trimmed.split(':').map(Number)
  let hours = 0
  let minutes = 0
  let seconds = 0
  if (parts.length === 1) {
    ;[seconds] = parts
  } else if (parts.length === 2) {
    ;[minutes, seconds] = parts
  } else {
    ;[hours, minutes, seconds] = parts
  }

  if (parts.length >= 2 && seconds >= 60) {
    throw new Error('Seconds must be less than 60')
  }
  if (parts.length >= 3 && minutes >= 60) {
    throw new Error('Minutes must be less than 60')
  }

  return { hours, minutes, seconds }
}

// Formats a {hours,minutes,seconds} object back into the compact text a
// TimeTextInput should display — blank when unset, otherwise m:ss / h:mm:ss.
export function formatTimeForInput(value) {
  const seconds = hmsToSeconds(value)
  if (seconds <= 0) return ''
  return secondsToClock(seconds)
}

// Shared "times list + average pace" summary used for both a logged
// segment's actual reps and (via the same shape) preview data.
export function summarizeReps(distanceMeters, reps) {
  const distanceMiles = metersToMiles(distanceMeters)
  const repSeconds = (reps || []).map((r) =>
    hmsToSeconds({ hours: r.time_hours, minutes: r.time_minutes, seconds: r.time_seconds })
  )
  const timesText = repSeconds.length > 0 ? repSeconds.map((s) => (s > 0 ? secondsToClock(s) : '—')).join(', ') : '—'
  const total = repSeconds.reduce((a, b) => a + b, 0)
  const avgSeconds = repSeconds.length > 0 ? total / repSeconds.length : 0
  const avgPace = avgSeconds > 0 ? calculatePace(distanceMiles, avgSeconds) : null
  return { timesText, avgPace }
}

// "8:42 AM" for a message sent today, "Yesterday", the weekday name within
// the past week, otherwise a short date — used by the mobile conversation
// list's per-row timestamp.
export function formatConversationTimestamp(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((startOfToday - startOfDate) / (1000 * 60 * 60 * 24))

  if (dayDiff <= 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// "QA Athlete" -> "Q" — used for a DM conversation-row avatar's initial
// when there's no photo to show. Group/team rows use a fixed icon instead
// (see MobileConversationList) rather than initials, so this only ever
// needs to disambiguate one person from another, not a whole label.
export function getInitials(name) {
  const trimmed = (name || '').trim()
  return trimmed ? trimmed[0].toUpperCase() : '?'
}

// Distance segments (running/swim/bike all share the same
// {distance_value, distance_unit, reps} shape) summed to miles, accounting
// for reps — converted regardless of the segment's own unit (yards/meters/
// km all fold down to miles here) since the calendar shows one figure
// across sports "for now" rather than per-sport units.
function sumSegmentDistanceMiles(segments) {
  const miles = (segments || []).reduce((total, seg) => {
    const meters = distanceToMeters(seg.distance_value, seg.distance_unit)
    return total + metersToMiles(meters) * (seg.reps || 1)
  }, 0)
  return Math.round(miles * 100) / 100
}

const ASSIGNED_SEGMENTS_FIELD_BY_TYPE = {
  running: 'assigned_running_segments',
  swim: 'assigned_swim_segments',
  bike: 'assigned_bike_segments',
}

const LOGGED_SEGMENTS_FIELD_BY_TYPE = {
  running: 'running_segments',
  swim: 'swim_segments',
  bike: 'bike_segments',
}

// Total assigned distance across a running/swim/bike assignment's target
// segments, in miles. Used by the athlete calendar to show assigned
// mileage on a day cell before it's logged. 0 for lifting/note (no
// distance concept).
export function sumAssignedDistanceMiles(assignment) {
  const field = ASSIGNED_SEGMENTS_FIELD_BY_TYPE[assignment?.type]
  return field ? sumSegmentDistanceMiles(assignment[field]) : 0
}

// Actual logged distance for a running/swim/bike workout, in miles. Running
// already stores a precomputed total_distance (in miles) on the workout row
// itself (see LogWorkoutForm's sumSegmentsDistanceMiles, which is what
// populates it) — swim/bike don't have that column, so their segments are
// summed the same way assigned distance is. 0 for lifting/note.
export function sumLoggedDistanceMiles(workout) {
  if (!workout) return 0
  if (workout.type === 'running' && workout.total_distance) return workout.total_distance
  const field = LOGGED_SEGMENTS_FIELD_BY_TYPE[workout.type]
  return field ? sumSegmentDistanceMiles(workout[field]) : 0
}

// Same segment list, but reported in whatever single unit was actually used
// to enter it, instead of converted to miles — only possible when every
// segment shares one unit. A workout that mixes units (e.g. a "2mi"
// warm-up plus "800m" repeats) has no single unit to report, so the caller
// falls back to a converted miles total in that case.
function sumSegmentDistanceSameUnit(segments) {
  if (!segments || segments.length === 0) return null
  const unit = segments[0].distance_unit
  if (!segments.every((s) => s.distance_unit === unit)) return null
  const value = segments.reduce((total, s) => total + (Number(s.distance_value) || 0) * (s.reps || 1), 0)
  return value > 0 ? { value, unit } : null
}

// Assigned distance for the athlete calendar's day cell, shown in whatever
// unit the coach actually assigned it in — falls back to a converted miles
// total when the assignment's target segments mix units.
export function assignedDistanceSummary(assignment) {
  const field = ASSIGNED_SEGMENTS_FIELD_BY_TYPE[assignment?.type]
  const sameUnit = field ? sumSegmentDistanceSameUnit(assignment[field]) : null
  if (sameUnit) return sameUnit
  const miles = sumAssignedDistanceMiles(assignment)
  return miles > 0 ? { value: miles, unit: 'miles' } : null
}

// Logged distance for the athlete calendar's day cell, shown in whatever
// unit the athlete actually logged it in — falls back to a converted miles
// total when the logged segments mix units (or, for a running log with no
// segment breakdown at all, its precomputed total_distance, which is always
// miles regardless of what unit the athlete originally typed).
export function loggedDistanceSummary(workout) {
  if (!workout) return null
  const field = LOGGED_SEGMENTS_FIELD_BY_TYPE[workout.type]
  const sameUnit = field ? sumSegmentDistanceSameUnit(workout[field]) : null
  if (sameUnit) return sameUnit
  const miles = sumLoggedDistanceMiles(workout)
  return miles > 0 ? { value: miles, unit: 'miles' } : null
}

const LOGGED_REPS_FIELD_BY_TYPE = {
  running: 'running_segment_reps',
  swim: 'swim_segment_reps',
  bike: 'bike_segment_reps',
}

// Total logged time across every rep of every segment in a running/swim/
// bike workout — running already has a precomputed total_duration_seconds
// (the athlete's own total, which may include rest/cooldown time the
// segments don't capture) and that's used in preference to re-summing the
// segments when present. 0 for lifting/note, or a distance-type workout
// logged with no rep times at all.
export function sumLoggedTimeSeconds(workout) {
  if (!workout) return 0
  if (workout.type === 'running' && workout.total_duration_seconds) return workout.total_duration_seconds
  const field = LOGGED_SEGMENTS_FIELD_BY_TYPE[workout.type]
  const repsField = LOGGED_REPS_FIELD_BY_TYPE[workout.type]
  if (!field || !repsField) return 0
  return (workout[field] || []).reduce((total, seg) => {
    const repSeconds = (seg[repsField] || []).reduce(
      (t, r) => t + hmsToSeconds({ hours: r.time_hours, minutes: r.time_minutes, seconds: r.time_seconds }),
      0
    )
    return total + repSeconds
  }, 0)
}

// Total *target* time across a running/swim/bike assignment's segments —
// each target segment stores one target time meant per-rep, so it's
// multiplied by that segment's rep count (unlike logged reps, which already
// have one row per rep). 0 for lifting/note.
export function sumAssignedTimeSeconds(assignment) {
  const field = ASSIGNED_SEGMENTS_FIELD_BY_TYPE[assignment?.type]
  if (!field) return 0
  return (assignment[field] || []).reduce((total, seg) => {
    const perRep = hmsToSeconds({
      hours: seg.target_time_hours,
      minutes: seg.target_time_minutes,
      seconds: seg.target_time_seconds,
    })
    return total + perRep * (seg.reps || 1)
  }, 0)
}

// The "what the athlete actually did" headline for a logged running/swim/
// bike workout — an ordered list of strings (distance, time, average pace)
// meant to be joined with " · " by the caller. Average pace is only
// included for running: swim/bike don't have a single meaningful overall
// pace figure in this app (see WorkoutCard's existing per-segment summary
// comments), so their headline is just distance + time.
export function loggedWorkoutHeadline(workout) {
  const distance = loggedDistanceSummary(workout)
  const seconds = sumLoggedTimeSeconds(workout)
  const parts = []
  if (distance) parts.push(`${formatDistanceValue(distance.value, distance.unit)}${unitAbbrev(distance.unit)}`)
  if (seconds > 0) parts.push(secondsToClock(seconds))
  if (workout?.type === 'running' && distance && seconds > 0) {
    const pace = calculatePace(sumLoggedDistanceMiles(workout), seconds)
    if (pace) parts.push(`${pace} avg`)
  }
  return parts
}

// The "what the coach prescribed" headline for a running/swim/bike
// assignment — same shape as loggedWorkoutHeadline, computed from target
// segments instead of logged ones.
export function assignedWorkoutHeadline(assignment) {
  const distance = assignedDistanceSummary(assignment)
  const seconds = sumAssignedTimeSeconds(assignment)
  const parts = []
  if (distance) parts.push(`${formatDistanceValue(distance.value, distance.unit)}${unitAbbrev(distance.unit)}`)
  if (seconds > 0) parts.push(secondsToClock(seconds))
  if (assignment?.type === 'running' && distance && seconds > 0) {
    const pace = calculatePace(sumAssignedDistanceMiles(assignment), seconds)
    if (pace) parts.push(`${pace} avg`)
  }
  return parts
}

// Compact one-line summary of an assigned_workouts row's target segments —
// e.g. "3×1mi @ 6:50" — shared by CoachAssignmentsPage's list rows and the
// assignment grid's cells (previously duplicated per-type inline in
// CoachAssignmentsPage, and without the target time). `assignment` is a raw
// DB row with its nested assigned_running_segments/assigned_swim_segments/
// assigned_bike_segments/assigned_lifting_targets children.
export function summarizeAssignment(assignment) {
  const segmentsByType = {
    running: assignment.assigned_running_segments,
    swim: assignment.assigned_swim_segments,
    bike: assignment.assigned_bike_segments,
  }
  const segments = segmentsByType[assignment.type]

  if (segments?.length > 0) {
    return segments
      .map((seg) => {
        const targetSeconds = hmsToSeconds({
          hours: seg.target_time_hours,
          minutes: seg.target_time_minutes,
          seconds: seg.target_time_seconds,
        })
        const label = seg.label ? `${seg.label}: ` : ''
        const repsPrefix = seg.reps > 1 ? `${seg.reps}×` : ''
        const time = targetSeconds > 0 ? ` @ ${secondsToClock(targetSeconds)}` : ''
        return `${label}${repsPrefix}${formatDistanceValue(seg.distance_value, seg.distance_unit)}${unitAbbrev(seg.distance_unit)}${time}`
      })
      .join(', ')
  }

  if (assignment.type === 'lifting' && assignment.assigned_lifting_targets?.length > 0) {
    return assignment.assigned_lifting_targets
      .map((t) => {
        const setsReps = t.target_sets && t.target_reps ? ` ${t.target_sets}×${t.target_reps}` : ''
        return `${t.exercise_name}${setsReps}`
      })
      .join(', ')
  }

  return ''
}

// Same "times list" as summarizeReps, plus averages of the two optional
// per-rep power-meter/cadence-sensor fields — averaged only across reps that
// actually have a value, since not every rep (or every athlete) tracks them.
export function summarizeBikeReps(distanceMeters, reps) {
  const { timesText } = summarizeReps(distanceMeters, reps)

  function average(field) {
    const values = (reps || []).map((r) => r[field]).filter((v) => v !== null && v !== undefined)
    if (values.length === 0) return null
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  }

  return { timesText, avgWatts: average('avg_watts'), avgCadence: average('avg_cadence') }
}
