import { describe, expect, it } from 'vitest'
import { DEFAULT_RIDER, GRAVITY, type RiderSettings } from './constants'
import { adjustedGradient, DESCENT_FLOOR, forcesAt, gradientToRadians } from './forces'
import { DEFAULT_DRIVETRAIN, GEAR_COUNT, relativeRatio, type DrivetrainSettings } from './gears'

const CASSETTE: DrivetrainSettings = { ...DEFAULT_DRIVETRAIN, mode: 'cassette' }
const ratio = (gear: number) => relativeRatio(gear, DEFAULT_DRIVETRAIN)

/** The least the trainer may be asked for at this speed and ratio: see DESCENT_FLOOR. */
const floorAt = (speed: number, r: number, rider: RiderSettings = DEFAULT_RIDER) =>
  forcesAt(0, speed, rider).total * DESCENT_FLOOR * r

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

/**
 * What the trainer will actually put against the rider, now that it is told to
 * add no rolling and no wind of its own: the along-slope pull of gravity at
 * the gradient it was sent, and nothing else.
 */
function delivered(gradientSent: number, rider: RiderSettings): number {
  return rider.massKg * GRAVITY * Math.sin(gradientToRadians(gradientSent))
}

describe('adjustedGradient at a neutral ratio', () => {
  // The design rests on this: at a relative ratio of 1 the rider must meet
  // exactly the force the real road would put against them — no more from the
  // gear, and nothing extra invented by the trainer. Cassette mode depends on
  // it, and so does the claim that gearing never distorts the route.
  // Downhill, where the honest force falls below the floor, the floor is
  // what the rider meets instead: a trainer cannot push.
  it('delivers exactly the road force across gradients and speeds, down to the floor', () => {
    for (const gradient of [-25, -12.5, -6, -1, 0, 1, 4.5, 8, 15, 25]) {
      for (const speed of [0, 2, 8, 20]) {
        const sent = adjustedGradient(gradient, speed, 1, DEFAULT_RIDER)
        const road = forcesAt(gradient, speed, DEFAULT_RIDER).total
        expect(delivered(sent, DEFAULT_RIDER)).toBeCloseTo(Math.max(road, floorAt(speed, 1)), 9)
        if (gradient >= 0) expect(delivered(sent, DEFAULT_RIDER)).toBeCloseTo(road, 9)
      }
    }
  })

  it('holds for any rider', () => {
    const riders: RiderSettings[] = [
      { massKg: 55, crr: 0.002, cda: 0.25 },
      { massKg: 120, crr: 0.008, cda: 0.55 },
    ]
    for (const rider of riders) {
      for (const gradient of [9, -9]) {
        const sent = adjustedGradient(gradient, 6, 1, rider)
        const road = forcesAt(gradient, 6, rider).total
        expect(delivered(sent, rider)).toBeCloseTo(Math.max(road, floorAt(6, 1, rider)), 9)
      }
    }
  })

  it('holds in cassette mode whatever gear is selected', () => {
    for (const gear of [1, 8, 12, 24]) {
      const r = relativeRatio(gear, CASSETTE)
      const sent = adjustedGradient(7.5, 9, r, DEFAULT_RIDER)
      expect(delivered(sent, DEFAULT_RIDER)).toBeCloseTo(
        forcesAt(7.5, 9, DEFAULT_RIDER).total,
        9,
      )
    }
  })

  // The bug this replaces the old identity for. Holding the road and the
  // speed still, every shift up must put more against the rider than the gear
  // below it — evenly, with no flat stretch in the middle of the block and no
  // gear that is easier than the one beneath it.
  it('makes every shift up bite harder, by the ratio and nothing else', () => {
    for (const [gradient, speed] of [
      [0, 7.5],
      [4, 5],
      [-5, 12],
    ] as const) {
      const road = forcesAt(gradient, speed, DEFAULT_RIDER).total
      let previous = Number.NEGATIVE_INFINITY
      for (let gear = 1; gear <= GEAR_COUNT; gear++) {
        const r = ratio(gear)
        const force = delivered(adjustedGradient(gradient, speed, r, DEFAULT_RIDER), DEFAULT_RIDER)
        expect(force).toBeGreaterThan(previous)
        // The gear is the whole of the difference: uphill it multiplies the
        // load, downhill it divides it, and the floor scales with it too.
        expect(force).toBeCloseTo(Math.max(road >= 0 ? road * r : road / r, floorAt(speed, r)), 6)
        previous = force
      }
    }
  })
})

describe('adjustedGradient uphill', () => {
  it('makes a climb harder in a harder gear and easier in an easier one', () => {
    const road = forcesAt(5, 5, DEFAULT_RIDER).total
    const at = (gear: number) =>
      delivered(adjustedGradient(5, 5, ratio(gear), DEFAULT_RIDER), DEFAULT_RIDER)

    expect(at(1)).toBeLessThan(road)
    // Gear 12 is the stock 34:14 to within a percent, so it is the road
    // itself to within a percent — not to within half a newton.
    expect(Math.abs(at(12) / road - 1)).toBeLessThan(0.02)
    expect(at(24)).toBeGreaterThan(road)
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
    expect(adjustedGradient(5, 5, ratio(24), DEFAULT_RIDER)).toBeCloseTo(13.987876, 5)
    expect(adjustedGradient(5, 5, ratio(12), DEFAULT_RIDER)).toBeCloseTo(6.067095, 5)
    expect(adjustedGradient(5, 5, ratio(1), DEFAULT_RIDER)).toBeCloseTo(1.892826, 5)
  })
})

describe('adjustedGradient downhill', () => {
  // Descending, a harder gear should give the rider something to push
  // against. That means less assistance, so the adjusted gradient moves
  // *towards* zero rather than away from it.
  it('gives more resistance in a harder gear, and something to push against in every gear', () => {
    const easy = adjustedGradient(-6, 12, ratio(1), DEFAULT_RIDER)
    const hard = adjustedGradient(-6, 12, ratio(24), DEFAULT_RIDER)

    expect(hard).toBeGreaterThan(easy)
    expect(easy).toBeGreaterThan(0)
  })

  it('matches the floor worked out by hand for the stock setup', () => {
    // 12 m/s on level road: drag ½ × 1.225 × 0.40 × 12² = 35.28 N, rolling
    // 85 × 9.8067 × 0.004 = 3.33 N. Half of that, times the gear's ratio to
    // the 34:14 the bike is in, as a slope for 85 kg.
    const level = 0.5 * 1.225 * 0.4 * 144 + 85 * GRAVITY * 0.004
    const slope = (r: number) => Math.tan(Math.asin((level * 0.5 * r) / (85 * GRAVITY))) * 100
    expect(adjustedGradient(-6, 12, ratio(24), DEFAULT_RIDER)).toBeCloseTo(slope(5.49 / (34 / 14)), 6)
    expect(adjustedGradient(-6, 12, ratio(1), DEFAULT_RIDER)).toBeCloseTo(slope(0.75 / (34 / 14)), 6)
  })

  // The first real ride: a Berlin descent, top gear, and the pedals turning
  // against nothing at all.
  it('never leaves the pedals empty', () => {
    for (const gradient of [-1, -3, -6, -12]) {
      for (const speed of [5, 9, 13]) {
        for (const gear of [1, 12, 24]) {
          const force = delivered(adjustedGradient(gradient, speed, ratio(gear), DEFAULT_RIDER), DEFAULT_RIDER)
          expect(force).toBeGreaterThan(0)
          // a slight descent taken fast still has the air winning: then the gear multiplies, as on the flat
          const road = forcesAt(gradient, speed, DEFAULT_RIDER).total
          const geared = road >= 0 ? road * ratio(gear) : road / ratio(gear)
          expect(force).toBeCloseTo(Math.max(geared, floorAt(speed, ratio(gear))), 6)
        }
      }
    }
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

describe('hill feel', () => {
  it('makes a climb feel like a shallower one', () => {
    // three quarters of 8% is 6%: the gravity part is scaled, air and tyres are not
    for (const speed of [3, 6, 9]) {
      const sent = adjustedGradient(8, speed, 1, DEFAULT_RIDER, 0.75)
      expect(delivered(sent, DEFAULT_RIDER)).toBeCloseTo(forcesAt(6, speed, DEFAULT_RIDER).total, 9)
    }
  })

  it('keeps the gear working on top of it', () => {
    const r = ratio(18)
    const sent = adjustedGradient(8, 5, r, DEFAULT_RIDER, 0.75)
    expect(delivered(sent, DEFAULT_RIDER)).toBeCloseTo(forcesAt(6, 5, DEFAULT_RIDER).total * r, 6)
  })

  it('leaves level road and descents as they are', () => {
    for (const gradient of [0, -3, -8]) {
      expect(adjustedGradient(gradient, 8, ratio(12), DEFAULT_RIDER, 0.75)).toBe(
        adjustedGradient(gradient, 8, ratio(12), DEFAULT_RIDER, 1),
      )
    }
  })

  it('is the whole climb unless asked otherwise', () => {
    expect(adjustedGradient(5, 5, ratio(12), DEFAULT_RIDER)).toBe(adjustedGradient(5, 5, ratio(12), DEFAULT_RIDER, 1))
  })
})
