import { useId } from 'react'
import { formatDistanceValue } from '../utils/format'

const SPORT_LABELS = { running: 'Running', swim: 'Swimming', bike: 'Cycling', other: 'Other' }

// Oval running track — one closed stadium-shaped path, traced twice (a
// muted track underneath, a colored fill on top). `pathLength="100"` lets
// the fill express percent directly via stroke-dasharray/-offset without
// ever needing to measure the path's true SVG length.
function RunningShape({ pct }) {
  const d = 'M38 12 H102 A24 24 0 0 1 102 60 H38 A24 24 0 0 1 38 12 Z'
  return (
    <svg viewBox="0 0 140 72" className="progress-shape" role="img" aria-hidden="true">
      <path d={d} pathLength="100" className="progress-track type-running" />
      {pct > 0 && (
        <path
          d={d}
          pathLength="100"
          className="progress-fill type-running"
          style={{ strokeDasharray: 100, strokeDashoffset: 100 - pct }}
        />
      )}
    </svg>
  )
}

// Pool — a static rounded-rect outline plus a bottom-anchored rect, clipped
// to that same rounded shape, whose height rises with pct (a water level).
function SwimShape({ pct }) {
  const clipId = useId()
  const x = 20
  const y = 12
  const w = 100
  const h = 48
  const waterH = (h * pct) / 100
  return (
    <svg viewBox="0 0 140 72" className="progress-shape" role="img" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={w} height={h} rx={8} />
        </clipPath>
      </defs>
      <rect x={x} y={y} width={w} height={h} rx={8} className="progress-track type-swim" />
      {waterH > 0 && (
        <rect
          x={x}
          y={y + h - waterH}
          width={w}
          height={waterH}
          clipPath={`url(#${clipId})`}
          className="progress-fill type-swim"
        />
      )}
    </svg>
  )
}

// Winding road — an S-curve path, same pathLength stroke-reveal technique as
// the running track, just styled thicker/muted to read as pavement.
function BikeShape({ pct }) {
  const d = 'M14 58 C 34 58, 34 18, 58 18 S 90 58, 114 58 S 122 30, 126 14'
  return (
    <svg viewBox="0 0 140 72" className="progress-shape" role="img" aria-hidden="true">
      <path d={d} pathLength="100" fill="none" className="progress-track type-bike" />
      {pct > 0 && (
        <path
          d={d}
          pathLength="100"
          fill="none"
          className="progress-fill type-bike"
          style={{ strokeDasharray: 100, strokeDashoffset: 100 - pct }}
        />
      )}
    </svg>
  )
}

// Heartbeat/pulse line — an ECG-style waveform, same pathLength stroke-
// reveal technique as running/bike, filling left-to-right along the line
// (its natural drawing direction) rather than around a loop or upward.
function OtherShape({ pct }) {
  const d = 'M10,36 L46,36 L54,14 L62,58 L70,10 L78,50 L86,36 L130,36'
  return (
    <svg viewBox="0 0 140 72" className="progress-shape" role="img" aria-hidden="true">
      <path d={d} pathLength="100" fill="none" className="progress-track type-other" />
      {pct > 0 && (
        <path
          d={d}
          pathLength="100"
          fill="none"
          className="progress-fill type-other"
          style={{ strokeDasharray: 100, strokeDashoffset: 100 - pct }}
        />
      )}
    </svg>
  )
}

const SHAPES_BY_SPORT = { running: RunningShape, swim: SwimShape, bike: BikeShape, other: OtherShape }

// One sport's weekly progress meter: shape + "current / goal mi" text.
// `goal` null/0 means no goal is set for this sport — the shape then
// renders unfilled and the text drops the "/ goal" half, rather than hiding
// the sport entirely (keeps all four meters always present, stable layout).
export default function SportProgressMeter({ sport, current, goal }) {
  const hasGoal = Boolean(goal && goal > 0)
  const pct = hasGoal ? Math.min(100, (current / goal) * 100) : 0
  const Shape = SHAPES_BY_SPORT[sport]
  const currentText = formatDistanceValue(current, 'miles')
  const goalText = hasGoal ? formatDistanceValue(goal, 'miles') : null

  return (
    <div className="progress-meter-card">
      <div className="progress-meter-label">{SPORT_LABELS[sport]}</div>
      <Shape pct={pct} />
      <div className="progress-meter-value">{hasGoal ? `${currentText} / ${goalText} mi` : `${currentText} mi`}</div>
    </div>
  )
}
