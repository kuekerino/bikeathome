/**
 * Rider and drivetrain settings, kept in local storage so a ride does not
 * start with someone else's weight.
 *
 * Everything read back is treated as hostile: stored settings outlive code
 * changes, and a stray NaN in the rider mass turns the whole physics model
 * into NaN with no obvious cause.
 */

import {
  DEFAULT_APPEARANCE,
  sanitizeAppearance,
  type AppearanceSettings,
} from './appearance'
import { DEFAULT_BINDINGS, sanitizeBindings, type Bindings } from './controls/bindings'
import { DEFAULT_RIDER, type RiderSettings } from './physics/constants'
import { DEFAULT_DRIVETRAIN, type DrivetrainSettings } from './physics/gears'
import { DEFAULT_HEART_RATE_CAP, type HeartRateCapSettings } from './ride/heartRateCap'

const STORAGE_KEY = 'bikeathome.settings.v1'

export interface AppSettings {
  rider: RiderSettings
  drivetrain: DrivetrainSettings
  /** What each key and each Click button does. */
  bindings: Bindings
  heartRateCap: HeartRateCapSettings
  /**
   * Functional threshold power, for workouts written as a percentage of it.
   * `null` until measured — a guessed FTP makes every relative session wrong
   * by the same unknown amount.
   */
  ftpW: number | null
  appearance: AppearanceSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  rider: DEFAULT_RIDER,
  drivetrain: DEFAULT_DRIVETRAIN,
  bindings: DEFAULT_BINDINGS,
  heartRateCap: DEFAULT_HEART_RATE_CAP,
  ftpW: null,
  appearance: DEFAULT_APPEARANCE,
}

/** Bounds are generous — they exist to stop nonsense, not to police riders. */
const LIMITS = {
  massKg: [30, 250],
  bpm: [80, 220],
  floorW: [0, 400],
  ftpW: [50, 600],
  crr: [0.001, 0.02],
  cda: [0.15, 1.2],
  teeth: [8, 60],
} as const

export function sanitizeSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS

  const input = raw as Partial<Record<keyof AppSettings | 'shifter', unknown>>
  const rider = (input.rider ?? {}) as Partial<Record<keyof RiderSettings, unknown>>
  const drivetrain = (input.drivetrain ?? {}) as Partial<
    Record<keyof DrivetrainSettings, unknown>
  >

  return {
    rider: {
      massKg: number(rider.massKg, DEFAULT_RIDER.massKg, LIMITS.massKg),
      crr: number(rider.crr, DEFAULT_RIDER.crr, LIMITS.crr),
      cda: number(rider.cda, DEFAULT_RIDER.cda, LIMITS.cda),
    },
    drivetrain: {
      mode: drivetrain.mode === 'cassette' ? 'cassette' : 'virtual',
      chainringTeeth: integer(
        drivetrain.chainringTeeth,
        DEFAULT_DRIVETRAIN.chainringTeeth,
        LIMITS.teeth,
      ),
      cogTeeth: integer(drivetrain.cogTeeth, DEFAULT_DRIVETRAIN.cogTeeth, LIMITS.teeth),
    },
    heartRateCap: sanitizeHeartRateCap(input.heartRateCap),
    appearance: sanitizeAppearance(input.appearance),
    ftpW:
      typeof input.ftpW === 'number' && Number.isFinite(input.ftpW) && input.ftpW > 0
        ? integer(input.ftpW, LIMITS.ftpW[0], LIMITS.ftpW)
        : null,
    // `shifter.swapButtons` was the old way of saying the same thing, and a
    // rider who had ticked it should not have to find the new control to get
    // their shifting back.
    bindings: sanitizeBindings(
      input.bindings,
      ((input.shifter ?? {}) as { swapButtons?: unknown }).swapButtons === true,
    ),
  }
}

function sanitizeHeartRateCap(raw: unknown): HeartRateCapSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_HEART_RATE_CAP

  const input = raw as Partial<Record<keyof HeartRateCapSettings, unknown>>
  const ceiling = input.ceilingBpm

  return {
    // A ceiling outside what a heart does is a stored mistake, and one that
    // would either never fire or never stop firing.
    // Zero and nonsense both mean "no ceiling"; anything else is clamped to a
    // rate a heart actually reaches, so a stored mistake cannot set a ceiling
    // that never fires or never stops firing.
    ceilingBpm:
      typeof ceiling === 'number' && Number.isFinite(ceiling) && ceiling > 0
        ? integer(ceiling, LIMITS.bpm[0], LIMITS.bpm)
        : null,
    autoBackOff: input.autoBackOff !== false,
    floorW: integer(input.floorW, DEFAULT_HEART_RATE_CAP.floorW, LIMITS.floorW),
  }
}

export function loadSettings(): AppSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? DEFAULT_SETTINGS : sanitizeSettings(JSON.parse(stored))
  } catch {
    // Corrupt or unparseable: defaults beat refusing to start.
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing and full quotas both land here. Not worth a ride.
  }
}

function number(value: unknown, fallback: number, [min, max]: readonly [number, number]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function integer(value: unknown, fallback: number, limits: readonly [number, number]): number {
  return Math.round(number(value, fallback, limits))
}
