import { describe, expect, it } from 'vitest'
import { buildCsv, csvFilename } from './csv'
import type { RideSample, TrainerTrace } from './recorder'

const START_MS = Date.UTC(2026, 10, 27, 15, 21, 36, 0)

const TRACE: TrainerTrace = {
  gear: 1,
  gearRatio: 0.75,
  relativeRatio: 0.75 / (34 / 14),
  routeGradientPct: 6.71,
  trainerGradientPct: 2.0444,
  heldPowerW: null,
  trainerSpeedKmh: 35.93,
  mode: 'virtual',
  chainringTeeth: 34,
  cogTeeth: 14,
  hillFeelPct: 100,
  massKg: 85,
  crr: 0.004,
  cda: 0.4,
}

function sample(overrides: Partial<RideSample> = {}): RideSample {
  return {
    time: START_MS,
    distanceM: 11480.04,
    lat: 39.75,
    lon: 3.13,
    altitudeM: 59.44,
    powerW: 174.4,
    cadenceRpm: 78.4,
    speedMs: 2.9722,
    heartRateBpm: 140,
    trace: TRACE,
    ...overrides,
  }
}

function table(csv: string): Record<string, string>[] {
  const [header, ...rows] = csv.trimEnd().split('\n')
  const names = header!.split(',')
  return rows.map((row) => Object.fromEntries(row.split(',').map((cell, i) => [names[i], cell])))
}

describe('buildCsv', () => {
  it('throws on an empty ride', () => {
    expect(() => buildCsv([])).toThrow(/empty/i)
  })

  it('writes one header row and one row per sample, every row as wide as the header', () => {
    const csv = buildCsv([sample(), sample({ time: START_MS + 1000 })])
    const lines = csv.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    const width = lines[0]!.split(',').length
    for (const line of lines) expect(line.split(',')).toHaveLength(width)
    expect(csv.endsWith('\n')).toBe(true)
  })

  it('carries the gear, the trainer and the settings alongside the ride', () => {
    const [row] = table(buildCsv([sample()]))
    expect(row).toEqual({
      time: '2026-11-27T15:21:36.000Z',
      elapsed_s: '0.0',
      distance_m: '11480.0',
      speed_kmh: '10.70',
      power_w: '174',
      cadence_rpm: '78',
      heart_rate_bpm: '140',
      altitude_m: '59.4',
      route_gradient_pct: '6.71',
      gear: '1',
      gear_ratio: '0.75',
      relative_ratio: '0.309',
      trainer_gradient_pct: '2.04',
      held_power_w: '',
      trainer_speed_kmh: '35.93',
      drivetrain: 'virtual',
      chainring: '34',
      cog: '14',
      hill_feel_pct: '100',
      mass_kg: '85',
      crr: '0.004',
      cda: '0.4',
    })
  })

  it('counts elapsed time from the first sample', () => {
    const rows = table(buildCsv([sample(), sample({ time: START_MS + 61_500 })]))
    expect(rows.map((row) => row.elapsed_s)).toEqual(['0.0', '61.5'])
  })

  it('shows a held power while the trainer holds one', () => {
    const [row] = table(buildCsv([sample({ trace: { ...TRACE, heldPowerW: 150 } })]))
    expect(row!.held_power_w).toBe('150')
  })

  it('leaves cells empty where there is nothing to say', () => {
    const [row] = table(
      buildCsv([
        sample({
          heartRateBpm: undefined,
          trace: { ...TRACE, trainerSpeedKmh: null },
        }),
      ]),
    )
    expect(row!.heart_rate_bpm).toBe('')
    expect(row!.trainer_speed_kmh).toBe('')
  })

  it('still exports a ride recorded before traces were kept, with those columns empty', () => {
    const [row] = table(buildCsv([sample({ trace: undefined })]))
    expect(row!.power_w).toBe('174')
    expect(row!.gear).toBe('')
    expect(row!.trainer_gradient_pct).toBe('')
    expect(row!.chainring).toBe('')
  })
})

describe('csvFilename', () => {
  it('matches the TCX name of the same ride', () => {
    const local = new Date(2026, 10, 27, 16, 21, 0)
    expect(csvFilename(local.getTime())).toBe('ride-20261127-1621.csv')
  })
})
