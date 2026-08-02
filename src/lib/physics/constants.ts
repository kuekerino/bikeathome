/** Standard gravity, m/s^2. */
export const GRAVITY = 9.8067

/** Air density at sea level, 15 C, in kg/m^3. */
export const AIR_DENSITY = 1.225

export interface RiderSettings {
  /** Rider plus bike, in kg. */
  massKg: number
  /** Coefficient of rolling resistance. ~0.004 for road tyres on tarmac. */
  crr: number
  /** Drag area in m^2. ~0.40 on the hoods, ~0.30 in the drops. */
  cda: number
}

export const DEFAULT_RIDER: RiderSettings = {
  massKg: 85,
  crr: 0.004,
  cda: 0.4,
}

/**
 * Propulsive force is power divided by speed, which runs away as speed
 * approaches zero. Flooring the divisor caps the force a standing start can
 * produce at a believable level instead of an infinite one.
 */
export const MIN_SPEED_FOR_FORCE = 0.9
