import { describe, expect, it } from 'vitest'
import { DEFAULT_RIDER, GRAVITY, type RiderSettings } from './constants'
import { adjustedGradient, forcesAt } from './forces'
import { DEFAULT_DRIVETRAIN, GEAR_COUNT, relativeRatio, type DrivetrainSettings } from './gears'

const CASSETTE: DrivetrainSettings = { ...DEFAULT_DRIVETRAIN, mode: 'cassette' }
const ratio = (gear: number) => relativeRatio(gear, DEFAULT_DRIVETRAIN)

describe('forcesAt', () => {
  it('puts gravity against the rider uphill and behind them downhill', () => {
    expect(forcesAt(5, 8, DEFAULT_RIDER).gravity).toBeGreaterThan(0)
    expect(forcesAt(-5, 8, DEFAULT_RIDER).gravity).toBeLessThan(0)
    expect(forcesAt(0, 8, DEFAULT_RIDER).gravity).toBeCloseTo(0, 9)
  })

  it('mirrors gravity between equal climbs and descents', () => {
    const up = forcesAt(7, 8, DEFAULT_RIDER).gravity
    const down = forcesAt(-7, 8, DEFAULT_RIDER).gravity
    expect(down).toBeCloseTo(-up, 9)
  })

  it('opposes the rider with rolling resistance whichever way the road goes', () => {
    expect(forcesAt(10, 5, DEFAULT_RIDER).rolling).toBeGreaterThan(0)
    expect(forcesAt(-10, 5, DEFAULT_RIDER).rolling).toBeGreaterThan(0)
  })

  it('scales drag with the square of speed', () => {
    const slow = forcesAt(0, 5, DEFAULT_RIDER).drag
    const fast = forcesAt(0, 10, DEFAULT_RIDER).drag
    expect(fast / slow).toBeCloseTo(4, 6)
    expect(forcesAt(0, 0, DEFAULT_RIDER).drag).toBe(0)
  })

  it('holds a flat rider up with weight times crr', () => {
    const { rolling } = forcesAt(0, 0, DEFAULT_RIDER)
    expect(rolling).toBeCloseTo(DEFAULT_RIDER.massKg * GRAVITY * DEFAULT_RIDER.crr, 9)
  })

  it('sums its parts', () => {
    const f = forcesAt(6, 7, DEFAULT_RIDER)
    expect(f.total).toBeCloseTo(f.gravity + f.rolling + f.drag, 9)
  })

  it('lets gravity win on a steep enough descent', () => {
    expect(forcesAt(-8, 5, DEFAULT_RIDER).total).toBeLessThan(0)
  })
})

describe('adjustedGradient at a neutral ratio', () => {
  // The whole design rests on this: at a relative ratio of 1 the conversion
  // must hand back exactly the gradient it was given. Cassette mode depends
  // on it, and so does the claim that gearing never distorts the route.
  it('is an exact identity across gradients and speeds', () => {
    for (const gradient of [-25, -12.5, -6, -1, 0, 1, 4.5, 8, 15, 25]) {
      for (const speed of [0, 2, 8, 20]) {
        expect(adjustedGradient(gradient, speed, 1, DEFAULT_RIDER)).toBeCloseTo(gradient, 9)
      }
    }
  })

  it('holds for any rider', () => {
    const riders: RiderSettings[] = [
      { massKg: 55, crr: 0.002, cda: 0.25 },
      { massKg: 120, crr: 0.008, cda: 0.55 },
    ]
    for (const rider of riders) {
      expect(adjustedGradient(9, 6, 1, rider)).toBeCloseTo(9, 9)
      expect(adjustedGradient(-9, 6, 1, rider)).toBeCloseTo(-9, 9)
    }
  })

  it('holds in cassette mode whatever gear is selected', () => {
    for (const gear of [1, 8, 12, 24]) {
      const r = relativeRatio(gear, CASSETTE)
      expect(adjustedGradient(7.5, 9, r, DEFAULT_RIDER)).toBeCloseTo(7.5, 9)
    }
  })
})

describe('adjustedGradient uphill', () => {
  it('makes a climb harder in a harder gear and easier in an easier one', () => {
    const easy = adjustedGradient(5, 5, ratio(1), DEFAULT_RIDER)
    const middle = adjustedGradient(5, 5, ratio(12), DEFAULT_RIDER)
    const hard = adjustedGradient(5, 5, ratio(24), DEFAULT_RIDER)

    expect(easy).toBeLessThan(5)
    expect(middle).toBeCloseTo(5, 0)
    expect(hard).toBeGreaterThan(5)
  })

  it('rises with every shift up', () => {
    let previous = Number.NEGATIVE_INFINITY
    for (let gear = 1; gear <= GEAR_COUNT; gear++) {
      const adjusted = adjustedGradient(6, 4, ratio(gear), DEFAULT_RIDER)
      expect(adjusted).toBeGreaterThan(previous)
      previous = adjusted
    }
  })

  it('matches the reference values for the stock setup', () => {
    expect(adjustedGradient(5, 5, ratio(24), DEFAULT_RIDER)).toBeCloseTo(12.8229, 3)
    expect(adjustedGradient(5, 5, ratio(12), DEFAULT_RIDER)).toBeCloseTo(4.9276, 3)
    expect(adjustedGradient(5, 5, ratio(1), DEFAULT_RIDER)).toBeCloseTo(0.7582, 3)
  })
})

describe('adjustedGradient downhill', () => {
  // Descending, a harder gear should give the rider something to push
  // against. That means less assistance, so the adjusted gradient moves
  // *towards* zero rather than away from it.
  it('gives more resistance in a harder gear', () => {
    const easy = adjustedGradient(-6, 12, ratio(1), DEFAULT_RIDER)
    const hard = adjustedGradient(-6, 12, ratio(24), DEFAULT_RIDER)

    expect(hard).toBeGreaterThan(easy)
    expect(hard).toBeLessThan(0)
  })

  it('matches the reference values for the stock setup', () => {
    expect(adjustedGradient(-6, 12, ratio(24), DEFAULT_RIDER)).toBeCloseTo(-5.2394, 3)
    expect(adjustedGradient(-6, 12, ratio(1), DEFAULT_RIDER)).toBeCloseTo(-9.0646, 3)
  })

  it('rises with every shift up', () => {
    let previous = Number.NEGATIVE_INFINITY
    for (let gear = 1; gear <= GEAR_COUNT; gear++) {
      const adjusted = adjustedGradient(-7, 14, ratio(gear), DEFAULT_RIDER)
      expect(adjusted).toBeGreaterThan(previous)
      previous = adjusted
    }
  })
})
