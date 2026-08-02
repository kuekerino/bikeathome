/**
 * Rider motion: how fast the virtual bike is going, and how far along the
 * route it has got.
 *
 * Speed comes from the power the trainer reports and the *real* gradient of
 * the route. The gear is deliberately absent — it changes how much power a
 * given cadence produces, not how far those watts carry you. Keeping it out
 * here is what makes recorded speed and distance honest, and what lets
 * cassette mode work with no separate code path.
 *
 * Integrated rather than solved so that acceleration, coasting and descents
 * fall out on their own instead of needing special cases.
 */

import { MIN_SPEED_FOR_FORCE, type RiderSettings } from './constants'
import { forcesAt } from './forces'

/**
 * Longest step the integrator will take. A backgrounded tab can hand back a
 * gap of many seconds; taking it whole would fling the rider up the road.
 */
export const MAX_STEP_S = 0.5

export interface MotionState {
  /** Metres per second. */
  speed: number
  /** Metres travelled along the route. */
  distance: number
}

export const MOTION_AT_REST: MotionState = { speed: 0, distance: 0 }

export interface MotionInput {
  /** Watts, as reported by the trainer. */
  powerW: number
  /** The route's own gradient at the rider's position, in percent. */
  gradientPct: number
  /** Seconds since the previous step. */
  dtSeconds: number
}

export function stepMotion(
  state: MotionState,
  input: MotionInput,
  rider: RiderSettings,
): MotionState {
  const dt = Math.min(Math.max(input.dtSeconds, 0), MAX_STEP_S)
  if (dt === 0) return state

  const resistance = forcesAt(input.gradientPct, state.speed, rider).total
  const propulsion =
    Math.max(input.powerW, 0) / Math.max(state.speed, MIN_SPEED_FOR_FORCE)

  // Freewheeling backwards down a climb is not a thing indoors.
  const speed = Math.max(0, state.speed + ((propulsion - resistance) / rider.massKg) * dt)

  return {
    speed,
    // Trapezoidal: averaging the endpoints tracks distance far better than
    // either one alone while the rider is still accelerating.
    distance: state.distance + ((state.speed + speed) / 2) * dt,
  }
}

/**
 * The speed this power settles at on this gradient, found directly rather
 * than by integrating. Used to cross-check the integrator, and to answer
 * "what would this effort be worth" without running a ride.
 */
export function steadyStateSpeed(
  powerW: number,
  gradientPct: number,
  rider: RiderSettings,
): number {
  // Strictly decreasing in v: propulsion falls as speed rises, resistance
  // climbs. So there is exactly one root, and bisection cannot miss it.
  const net = (v: number): number =>
    (v > 0 ? Math.max(powerW, 0) / v : Number.POSITIVE_INFINITY) -
    forcesAt(gradientPct, v, rider).total

  if (net(1e-6) <= 0) return 0

  let low = 0
  let high = 1
  while (net(high) > 0 && high < 1024) high *= 2

  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2
    if (net(mid) > 0) low = mid
    else high = mid
  }

  return (low + high) / 2
}
