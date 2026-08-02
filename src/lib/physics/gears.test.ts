import { describe, expect, it } from 'vitest'
import {
  baselineRatio,
  clampGear,
  DEFAULT_DRIVETRAIN,
  DEFAULT_GEAR,
  GEAR_COUNT,
  GEAR_RATIOS,
  gearRatio,
  relativeRatio,
  shiftGear,
  type DrivetrainSettings,
} from './gears'

const CASSETTE: DrivetrainSettings = { ...DEFAULT_DRIVETRAIN, mode: 'cassette' }

describe('gear table', () => {
  it('has 24 gears', () => {
    expect(GEAR_COUNT).toBe(24)
  })

  it('rises strictly from easiest to hardest', () => {
    for (let i = 1; i < GEAR_RATIOS.length; i++) {
      expect(GEAR_RATIOS[i]!).toBeGreaterThan(GEAR_RATIOS[i - 1]!)
    }
  })

  it('spans the range Zwift exposes', () => {
    expect(GEAR_RATIOS[0]).toBe(0.75)
    expect(GEAR_RATIOS[GEAR_COUNT - 1]).toBe(5.49)
  })
})

describe('clampGear', () => {
  it('keeps gears in range', () => {
    expect(clampGear(0)).toBe(1)
    expect(clampGear(-5)).toBe(1)
    expect(clampGear(25)).toBe(GEAR_COUNT)
    expect(clampGear(7)).toBe(7)
  })

  it('rounds fractional gears', () => {
    expect(clampGear(7.4)).toBe(7)
    expect(clampGear(7.6)).toBe(8)
  })

  it('falls back to the default for nonsense', () => {
    expect(clampGear(Number.NaN)).toBe(DEFAULT_GEAR)
    expect(clampGear(Number.POSITIVE_INFINITY)).toBe(DEFAULT_GEAR)
  })
})

describe('shiftGear', () => {
  it('moves one gear at a time', () => {
    expect(shiftGear(12, 1)).toBe(13)
    expect(shiftGear(12, -1)).toBe(11)
  })

  it('stops at the ends instead of wrapping', () => {
    expect(shiftGear(1, -1)).toBe(1)
    expect(shiftGear(GEAR_COUNT, 1)).toBe(GEAR_COUNT)
  })
})

describe('relativeRatio', () => {
  it('treats the default gear as very nearly neutral', () => {
    expect(relativeRatio(DEFAULT_GEAR, DEFAULT_DRIVETRAIN)).toBeCloseTo(1, 1)
  })

  it('is measured against the fitted drivetrain', () => {
    expect(baselineRatio(DEFAULT_DRIVETRAIN)).toBeCloseTo(34 / 14, 9)
    expect(relativeRatio(24, DEFAULT_DRIVETRAIN)).toBeCloseTo(5.49 / (34 / 14), 9)
  })

  it('rises with gear', () => {
    for (let gear = 2; gear <= GEAR_COUNT; gear++) {
      expect(relativeRatio(gear, DEFAULT_DRIVETRAIN)).toBeGreaterThan(
        relativeRatio(gear - 1, DEFAULT_DRIVETRAIN),
      )
    }
  })

  it('shifts with a different chainring', () => {
    const compact: DrivetrainSettings = { ...DEFAULT_DRIVETRAIN, chainringTeeth: 50 }
    expect(relativeRatio(12, compact)).toBeLessThan(relativeRatio(12, DEFAULT_DRIVETRAIN))
  })

  it('is always exactly 1 in cassette mode', () => {
    for (let gear = 1; gear <= GEAR_COUNT; gear++) {
      expect(relativeRatio(gear, CASSETTE)).toBe(1)
    }
  })
})

describe('gearRatio', () => {
  it('returns the absolute ratio and clamps out-of-range gears', () => {
    expect(gearRatio(1)).toBe(0.75)
    expect(gearRatio(99)).toBe(5.49)
  })
})
