/**
 * Rider and drivetrain settings, kept in local storage so a ride does not
 * start with someone else's weight.
 *
 * Everything read back is treated as hostile: stored settings outlive code
 * changes, and a stray NaN in the rider mass turns the whole physics model
 * into NaN with no obvious cause.
 */

import { DEFAULT_RIDER, type RiderSettings } from './physics/constants'
import { DEFAULT_DRIVETRAIN, type DrivetrainSettings } from './physics/gears'

const STORAGE_KEY = 'bikeathome.settings.v1'

export interface AppSettings {
  rider: RiderSettings
  drivetrain: DrivetrainSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  rider: DEFAULT_RIDER,
  drivetrain: DEFAULT_DRIVETRAIN,
}

/** Bounds are generous — they exist to stop nonsense, not to police riders. */
const LIMITS = {
  massKg: [30, 250],
  crr: [0.001, 0.02],
  cda: [0.15, 1.2],
  teeth: [8, 60],
} as const

export function sanitizeSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS

  const input = raw as Partial<Record<keyof AppSettings, unknown>>
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
