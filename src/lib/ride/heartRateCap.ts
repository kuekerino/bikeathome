/**
 * Keeping a steady-power effort under a heart rate ceiling.
 *
 * The problem this exists for: the same wattage costs a different heart rate
 * on a hot day, on tired legs, or after bad sleep. An endurance session
 * prescribed in watts therefore drifts out of its zone through no fault of the
 * rider, and by the time that is noticed the session is spent.
 *
 * So the rider sets the watts they want *and* the rate they must not exceed,
 * and the target is pulled down when the heart disagrees.
 *
 * Three things make this behave rather than oscillate:
 *
 * - It comes down faster than it goes back up. Overshooting the ceiling is the
 *   failure being prevented; taking an extra minute to recover the target is
 *   not a failure at all.
 * - There is a deadband under the ceiling. Recovering the moment the rate dips
 *   one beat below would sit the rider on the limit, alternating.
 * - It never exceeds what the rider asked for. This only ever takes away.
 */

export interface HeartRateCapSettings {
  /** Beats per minute not to exceed, or `null` for no ceiling. */
  ceilingBpm: number | null
  /** Pull the power down automatically, rather than only warning. */
  autoBackOff: boolean
  /** Never pull below this, however high the rate goes. */
  floorW: number
}

export const DEFAULT_HEART_RATE_CAP: HeartRateCapSettings = {
  ceilingBpm: null,
  autoBackOff: true,
  floorW: 60,
}

/** Watts per second the target comes down while over the ceiling. */
const FALL_W_PER_S = 6
/** Watts per second it climbs back once safely under. */
const RISE_W_PER_S = 2
/** How far under the ceiling the rate must fall before the target recovers. */
const DEADBAND_BPM = 4

export interface CapInput {
  /** What the rider asked for. */
  chosenW: number
  /** What is being sent right now. */
  appliedW: number
  /** The latest reading, or `null` if no strap is reporting. */
  heartRateBpm: number | null
  dtSeconds: number
}

/**
 * The wattage to send next.
 *
 * With no ceiling, no strap or auto back-off switched off, this is the rider's
 * own target — including releasing any hold-back still in force, so unpairing
 * a strap mid-ride cannot leave the effort permanently suppressed.
 */
export function nextAppliedPower(input: CapInput, settings: HeartRateCapSettings): number {
  const { chosenW, appliedW, heartRateBpm, dtSeconds } = input
  const { ceilingBpm, autoBackOff, floorW } = settings

  if (!autoBackOff || ceilingBpm === null || heartRateBpm === null) return chosenW

  const floor = Math.min(floorW, chosenW)
  const dt = Math.max(0, dtSeconds)

  if (heartRateBpm > ceilingBpm) {
    return Math.max(floor, appliedW - FALL_W_PER_S * dt)
  }
  if (heartRateBpm < ceilingBpm - DEADBAND_BPM) {
    return Math.min(chosenW, appliedW + RISE_W_PER_S * dt)
  }
  // Inside the deadband: hold, but never above what was asked for.
  return Math.min(chosenW, appliedW)
}

/** Whether the rate is over the line right now — for the warning, not the maths. */
export function isOverCeiling(
  heartRateBpm: number | null,
  settings: HeartRateCapSettings,
): boolean {
  return (
    heartRateBpm !== null && settings.ceilingBpm !== null && heartRateBpm > settings.ceilingBpm
  )
}
