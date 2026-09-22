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
 * The whole resisting force is expressed as a slope, and the trainer is told
 * to add no rolling and no wind resistance of its own — see
 * {@link TRAINER_ADDS_NOTHING}. That is what makes a gear mean something.
 *
 * It used to subtract the trainer's own rolling and drag back out, computed at
 * the *road* speed. But the trainer has no idea what the road speed is: the
 * only speed it knows is its wheel, which turns with the rider's cadence
 * through the fitted cog. A harder virtual gear is a lower cadence at the same
 * road speed, so the wheel slows, so the drag the trainer adds falls — by more
 * than the gear raised the slope. Shifting up therefore did almost nothing
 * through the middle of the block and made it *easier* at the bottom: at
 * 27 km/h the force actually delivered ran 55.7 N in gear 8, 24.5 N in gear
 * 16 and 30.3 N in gear 24, when it should have climbed evenly from 11.8 N to
 * 38.7 N. A shifter that does nothing is a shifter you keep pulling, which is
 * exactly what it felt like.
 *
 * Taking the trainer's own terms away leaves the force it applies equal to the
 * force asked for, whatever the wheel happens to be doing.
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
  const { total } = forcesAt(gradientPct, speedMs, rider)

  // Uphill the gear multiplies the load; downhill it divides it, so a harder
  // gear gives something to push against instead of spinning out.
  const geared = total >= 0 ? total * relativeRatio : total / relativeRatio

  return forceToGradient(geared, rider)
}

/**
 * The slope that asks a trainer for this force, given it adds nothing of its
 * own. Newtons in, percent out.
 */
export function forceToGradient(force: number, rider: RiderSettings): number {
  const sine = clamp(force / (rider.massKg * GRAVITY), -0.99, 0.99)
  return Math.tan(Math.asin(sine)) * 100
}

/**
 * What we tell the trainer its own rolling and wind resistance are: nothing.
 *
 * Every resisting force is already in the gradient, worked out at the speed
 * the rider is really travelling. Letting the trainer add more, from a wheel
 * speed that is not the road speed, is what broke virtual shifting.
 */
export const TRAINER_ADDS_NOTHING = { crr: 0, cw: 0 } as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
