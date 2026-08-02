/**
 * The force model, and the conversion from "route gradient plus gear" into the
 * gradient the trainer is told to simulate.
 *
 * Follows the "track resistance" approach documented by SHIFTR: apply the gear
 * to the total resisting force, then express the result as a gradient again.
 * Keeping the trainer in simulation mode means descents still feel like
 * descents, and the watts it reports stay the watts the rider produced.
 */

import { AIR_DENSITY, GRAVITY, type RiderSettings } from './constants'

export interface Forces {
  /** Along-slope component of weight. Negative downhill. */
  gravity: number
  /** Rolling resistance, always opposing. */
  rolling: number
  /** Aerodynamic drag, always opposing. */
  drag: number
  /** What the rider has to overcome, in newtons. Negative when gravity wins. */
  total: number
}

export function gradientToRadians(gradientPct: number): number {
  return Math.atan(gradientPct / 100)
}

export function forcesAt(
  gradientPct: number,
  speedMs: number,
  rider: RiderSettings,
): Forces {
  const slope = gradientToRadians(gradientPct)
  const weight = rider.massKg * GRAVITY

  const gravity = weight * Math.sin(slope)
  const rolling = weight * Math.cos(slope) * rider.crr
  const drag = 0.5 * AIR_DENSITY * rider.cda * speedMs * speedMs

  return { gravity, rolling, drag, total: gravity + rolling + drag }
}

/**
 * The gradient to send the trainer so that the rider feels `relativeRatio`
 * times the force the real gradient would give them.
 *
 * The trainer adds its own rolling and drag on top of whatever gradient it is
 * given, so those are subtracted back out here and only the gravity-like
 * remainder is expressed as a gradient.
 *
 * At `relativeRatio` of 1 this is an exact identity: it returns `gradientPct`
 * unchanged. That is what lets cassette mode share this code path.
 *
 * The result is not clipped to any trainer's range — that belongs with the
 * device, which knows its own limits.
 */
export function adjustedGradient(
  gradientPct: number,
  speedMs: number,
  relativeRatio: number,
  rider: RiderSettings,
): number {
  const { rolling, drag, total } = forcesAt(gradientPct, speedMs, rider)

  // Uphill the gear multiplies the load; downhill it divides it, so a harder
  // gear gives something to push against instead of spinning out.
  const geared = total >= 0 ? total * relativeRatio : total / relativeRatio

  const gravityOnly = geared - rolling - drag
  const sine = clamp(gravityOnly / (rider.massKg * GRAVITY), -0.99, 0.99)

  return Math.tan(Math.asin(sine)) * 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
