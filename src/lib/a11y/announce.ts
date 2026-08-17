/**
 * What to say out loud, and when.
 *
 * A screen reader reading a live dashboard is useless: power changes four
 * times a second, and announcing it would drown out everything that matters.
 * So nothing is announced for merely changing. Announcements are for *events* —
 * a new interval, the heart rate ceiling crossed, the ride ending — the things
 * a sighted rider notices by glancing up.
 *
 * Everything else is available on demand instead, through
 * {@link describeStatus} bound to a key or a shifter button.
 */

import type { RideSnapshot } from '../ride/engine'
import { describeStep } from '../workout/model'

/** Compares two snapshots and returns the one thing worth saying, if any. */
export function announcementFor(
  previous: RideSnapshot | null,
  current: RideSnapshot,
  ftpW: number | null,
): string | null {
  if (!previous) return null

  if (previous.status !== current.status) {
    const said = statusChange(current.status)
    if (said) return said
  }

  const before = previous.workout
  const now = current.workout

  if (now && before) {
    if (!before.finished && now.finished) {
      return 'Workout finished. Resistance is back on the gradient.'
    }
    if (now.step && now.stepIndex !== before.stepIndex) {
      return stepChange(now, ftpW)
    }
  }

  // Only worth saying when it changes: repeating it every second would be the
  // same mistake as reading the power out.
  if (current.overCeiling !== previous.overCeiling) {
    return current.overCeiling
      ? `Heart rate over the ceiling, ${current.heartRateBpm ?? 0}.`
      : 'Heart rate back under the ceiling.'
  }

  // Shifting is something the rider did, so it deserves an answer — but only
  // when the gear is actually doing something. Holding a power, it is not.
  if (current.gear !== previous.gear && current.targetPowerW === null) {
    return `Gear ${current.gear}.`
  }

  return null
}

function statusChange(status: RideSnapshot['status']): string | null {
  switch (status) {
    case 'riding':
      return 'Riding.'
    case 'paused':
      return 'Paused.'
    case 'finished':
      return 'Ride finished.'
    default:
      return null
  }
}

function stepChange(workout: NonNullable<RideSnapshot['workout']>, ftpW: number | null): string {
  const step = workout.step
  if (!step) return ''

  const where = step.repeat
    ? `Interval ${step.repeat.index} of ${step.repeat.total}`
    : (step.step.label ?? 'Next step')
  const cadence = step.step.cadenceRpm ? `, ${step.step.cadenceRpm} rpm` : ''

  return `${where}. ${describeStep(step.step, ftpW)} for ${spoken(step.step.seconds)}${cadence}.`
}

/** The whole picture, for a rider who asked rather than one who is waiting. */
export function describeStatus(snapshot: RideSnapshot): string {
  const parts = [
    `${Math.round(snapshot.powerW)} watts`,
    `${Math.round(snapshot.cadenceRpm)} rpm`,
    `${(snapshot.speedMs * 3.6).toFixed(1)} kilometres per hour`,
  ]

  if (snapshot.heartRateBpm !== null) parts.push(`${snapshot.heartRateBpm} beats`)
  if (snapshot.targetPowerW !== null) {
    const held = snapshot.heldPowerW ?? snapshot.targetPowerW
    parts.push(
      held < snapshot.targetPowerW
        ? `holding ${held} watts, eased off from ${snapshot.targetPowerW}`
        : `target ${snapshot.targetPowerW} watts`,
    )
  }
  parts.push(`${(snapshot.distance / 1000).toFixed(2)} kilometres`)
  parts.push(`${spoken(snapshot.elapsedSeconds)} elapsed`)

  return `${parts.join(', ')}.`
}

/** "3 minutes 30" reads better aloud than "3:30", which is read as a time. */
function spoken(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60

  if (minutes === 0) return `${rest} seconds`
  if (rest === 0) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ${rest}`
}
