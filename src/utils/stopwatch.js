import { useCallback, useEffect, useRef, useState } from 'react'
import { onAppResume } from './appResume'
import { hmsToSeconds } from './format'

// A wall-clock-anchored stopwatch: elapsed time is always `Date.now() -
// startedAt`, never accumulated tick-by-tick — so a screen lock or
// backgrounded tab that throttles (or fully suspends) the interval never
// drifts the displayed time. The system clock keeps advancing regardless of
// whether this tab's JS is even running; the moment a tick (or an
// onAppResume callback) fires again, recomputing from Date.now() is
// instantly correct no matter how long the gap was, unlike a naive
// increment-per-tick counter which would lose exactly however long the
// interval was paused. Same reasoning as this app's other backgrounding
// fixes — see CLAUDE.md's "PWA reliability" section.
export function useStopwatch() {
  const [running, setRunning] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef(null) // Date.now() when start() was last called
  const frozenAtRef = useRef(0) // elapsedMs snapshot captured by stop()

  const tick = useCallback(() => {
    if (startedAtRef.current == null) return
    setElapsedMs(Date.now() - startedAtRef.current)
  }, [])

  useEffect(() => {
    if (!running) return undefined
    tick()
    const id = setInterval(tick, 30)
    return () => clearInterval(id)
  }, [running, tick])

  // Forces an immediate recompute the moment the app comes back to the
  // foreground, rather than waiting for the next 30ms tick — the display
  // would otherwise sit frozen at its last pre-background value until then.
  useEffect(
    () =>
      onAppResume(() => {
        if (running) tick()
      }),
    [running, tick]
  )

  const start = useCallback(() => {
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setRunning(true)
  }, [])

  const stop = useCallback(() => {
    if (startedAtRef.current != null) frozenAtRef.current = Date.now() - startedAtRef.current
    setElapsedMs(frozenAtRef.current)
    setRunning(false)
  }, [])

  const reset = useCallback(() => {
    startedAtRef.current = null
    frozenAtRef.current = 0
    setElapsedMs(0)
    setRunning(false)
  }, [])

  // Reads the true elapsed time at THIS exact instant, straight off the
  // wall clock — used for capturing a tap's timestamp, rather than the
  // `elapsedMs` state, which can be up to one 30ms tick stale. Precision at
  // the moment of the tap is what the delta math (see msToHms below) is
  // built on, not the live display's own refresh rate.
  const getElapsedMs = useCallback(() => {
    if (!running || startedAtRef.current == null) return elapsedMs
    return Date.now() - startedAtRef.current
  }, [running, elapsedMs])

  return { running, elapsedMs, start, stop, reset, getElapsedMs }
}

// A stopwatch-specific display format ("01:14.32") — always shows minutes
// (unlike secondsToClock's "m:ss", which drops the leading unit when it's
// zero), since a live master clock reads better with a stable width than
// one that reflows every time it crosses a minute boundary.
export function formatStopwatchClock(ms) {
  const totalCentis = Math.max(0, Math.floor(ms / 10))
  const centis = totalCentis % 100
  const totalSeconds = Math.floor(totalCentis / 100)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(minutes)}:${pad(seconds)}.${pad(centis)}`
}

// Converts a millisecond duration into the {hours,minutes,seconds,
// centiseconds} shape every rep-time field in this app already uses.
// Integer math throughout — never routed through hmsToSeconds/
// secondsToClock's own floating-point display rounding — so a tap-to-tap
// delta always stores exactly what the clock showed, to the hundredth.
export function msToHms(ms) {
  const totalCentis = Math.max(0, Math.round(ms / 10))
  const centiseconds = totalCentis % 100
  const totalSeconds = Math.floor(totalCentis / 100)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return { hours, minutes, seconds, centiseconds }
}

// The next slot in `values` (this app's own "0 means unfilled" convention —
// see formatRepTimesList/buildAthletePayload's own header comments
// elsewhere) that a stopwatch tap should record into. `count` is the
// athlete's own real column/slot count (never the grid's padded maxColumns,
// and never segmentDrafts' full length either — callers pass however many
// slots actually apply to this athlete). -1 once every slot already has a
// real time in it.
export function findNextOpenIndex(values, count) {
  for (let i = 0; i < count; i++) {
    const v = values?.[i]
    if (!v || hmsToSeconds(v) <= 0) return i
  }
  return -1
}
