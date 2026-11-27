/**
 * Every recorded second of a ride as a table, with the things a TCX has no
 * place for: the gear, what the trainer was asked to simulate, its own wheel
 * speed, and the settings all of that was worked out from.
 *
 * For working out what a ride felt like and why, not for uploading anywhere.
 * The TCX stays exactly as it was, so Strava and the rest go on accepting it.
 *
 * Plain comma-separated, a dot for decimals, one header row. A cell is empty
 * where there is nothing to say: no strap, no trace on a ride recorded before
 * traces were kept, no wheel speed from a trainer that reports none.
 */

import type { RideSample, TrainerTrace } from './recorder'

type Cell = string | number | null | undefined

interface Column {
  name: string
  value: (sample: RideSample, trace: TrainerTrace | undefined, startMs: number) => Cell
}

const COLUMNS: readonly Column[] = [
  { name: 'time', value: (s) => new Date(s.time).toISOString() },
  { name: 'elapsed_s', value: (s, _, start) => fixed((s.time - start) / 1000, 1) },
  { name: 'distance_m', value: (s) => fixed(s.distanceM, 1) },
  { name: 'speed_kmh', value: (s) => fixed(s.speedMs * 3.6, 2) },
  { name: 'power_w', value: (s) => Math.round(s.powerW) },
  { name: 'cadence_rpm', value: (s) => Math.round(s.cadenceRpm) },
  { name: 'heart_rate_bpm', value: (s) => s.heartRateBpm },
  { name: 'altitude_m', value: (s) => fixed(s.altitudeM, 1) },
  { name: 'route_gradient_pct', value: (_, t) => fixed(t?.routeGradientPct, 2) },
  { name: 'gear', value: (_, t) => t?.gear },
  { name: 'gear_ratio', value: (_, t) => fixed(t?.gearRatio, 2) },
  { name: 'relative_ratio', value: (_, t) => fixed(t?.relativeRatio, 3) },
  { name: 'trainer_gradient_pct', value: (_, t) => fixed(t?.trainerGradientPct, 2) },
  { name: 'held_power_w', value: (_, t) => t?.heldPowerW },
  { name: 'trainer_speed_kmh', value: (_, t) => fixed(t?.trainerSpeedKmh, 2) },
  { name: 'drivetrain', value: (_, t) => t?.mode },
  { name: 'chainring', value: (_, t) => t?.chainringTeeth },
  { name: 'cog', value: (_, t) => t?.cogTeeth },
  { name: 'hill_feel_pct', value: (_, t) => t?.hillFeelPct },
  { name: 'mass_kg', value: (_, t) => t?.massKg },
  { name: 'crr', value: (_, t) => t?.crr },
  { name: 'cda', value: (_, t) => t?.cda },
]

export function buildCsv(samples: readonly RideSample[]): string {
  const first = samples[0]
  if (!first) throw new Error('Cannot build a CSV file from an empty ride.')

  const header = COLUMNS.map((column) => column.name).join(',')
  const rows = samples.map((sample) =>
    COLUMNS.map((column) => cell(column.value(sample, sample.trace, first.time))).join(','),
  )
  return [header, ...rows].join('\n') + '\n'
}

/** `ride-YYYYMMDD-HHMM.csv`, matching the TCX of the same ride. */
export function csvFilename(startedAtMs: number): string {
  const date = new Date(startedAtMs)
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `ride-${stamp}.csv`
}

function fixed(value: number | null | undefined, digits: number): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined
  return value.toFixed(digits)
}

function cell(value: Cell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  // Nothing written here holds a comma or a quote today, but a cell that ever
  // did would silently shift every column after it.
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
