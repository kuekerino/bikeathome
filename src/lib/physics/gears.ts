/**
 * Virtual gearing.
 *
 * With a single-cog trainer the rider cannot shift, so the app does it: the
 * gear scales the force the trainer asks for, which changes how much power a
 * given cadence produces. The gear deliberately plays no part in working out
 * how fast the rider is travelling — see `motion.ts`.
 */

/**
 * The 24 ratios Zwift exposes for virtual shifting, kept so the feel matches
 * what riders are used to elsewhere. Roughly a 9% step between gears.
 */
export const GEAR_RATIOS: readonly number[] = [
  0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68, 1.86, 2.04, 2.22, 2.4, 2.61, 2.82, 3.03,
  3.24, 3.49, 3.74, 3.99, 4.24, 4.54, 4.84, 5.14, 5.49,
]

export const GEAR_COUNT = GEAR_RATIOS.length

/** Gear 12 sits closest to the stock 34:14 drivetrain, so rides start neutral. */
export const DEFAULT_GEAR = 12

export type DrivetrainMode =
  /** Single cog: the app shifts, the trainer's resistance changes. */
  | 'virtual'
  /** Real cassette: the rider shifts, the app leaves resistance alone. */
  | 'cassette'

export interface DrivetrainSettings {
  mode: DrivetrainMode
  /** Teeth on the chainring the bike is actually in. */
  chainringTeeth: number
  /** Teeth on the fitted cog — 14 for the Zwift Cog. */
  cogTeeth: number
}

export const DEFAULT_DRIVETRAIN: DrivetrainSettings = {
  mode: 'virtual',
  chainringTeeth: 34,
  cogTeeth: 14,
}

/** The ratio the bike is physically in, which virtual gears are measured against. */
export function baselineRatio(drivetrain: DrivetrainSettings): number {
  return drivetrain.chainringTeeth / drivetrain.cogTeeth
}

export function clampGear(gear: number): number {
  if (!Number.isFinite(gear)) return DEFAULT_GEAR
  return Math.min(GEAR_COUNT, Math.max(1, Math.round(gear)))
}

export function shiftGear(gear: number, direction: 1 | -1): number {
  return clampGear(clampGear(gear) + direction)
}

/** Absolute ratio of a gear, independent of the bike it is fitted to. */
export function gearRatio(gear: number): number {
  return GEAR_RATIOS[clampGear(gear) - 1]!
}

/**
 * How much harder or easier this gear is than the bike's own drivetrain.
 * Above 1 means a harder gear. Always 1 in cassette mode, which is what makes
 * the rest of the physics collapse back to a plain gradient simulation.
 */
export function relativeRatio(gear: number, drivetrain: DrivetrainSettings): number {
  if (drivetrain.mode === 'cassette') return 1
  return gearRatio(gear) / baselineRatio(drivetrain)
}
