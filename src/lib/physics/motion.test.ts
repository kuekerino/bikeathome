import { describe, expect, it } from 'vitest'
import { DEFAULT_RIDER, type RiderSettings } from './constants'
import { MAX_STEP_S, MOTION_AT_REST, stepMotion, steadyStateSpeed, type MotionState } from './motion'

function integrate(
  powerW: number,
  gradientPct: number,
  seconds: number,
  options: { rider?: RiderSettings; dt?: number; from?: MotionState } = {},
): MotionState {
  const { rider = DEFAULT_RIDER, dt = 0.25, from = MOTION_AT_REST } = options
  let state = from
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    state = stepMotion(state, { powerW, gradientPct, dtSeconds: dt }, rider)
  }
  return state
}

describe('steadyStateSpeed', () => {
  it('matches known-good reference speeds', () => {
    // 250 W on the flat is ~34.6 km/h, and coasting a 6% descent settles
    // near 50 km/h. Both are where a real rider ends up.
    expect(steadyStateSpeed(250, 0, DEFAULT_RIDER)).toBeCloseTo(9.6173, 3)
    expect(steadyStateSpeed(200, 0, DEFAULT_RIDER)).toBeCloseTo(8.861, 3)
    expect(steadyStateSpeed(250, 8, DEFAULT_RIDER)).toBeCloseTo(3.4391, 3)
    expect(steadyStateSpeed(0, -6, DEFAULT_RIDER)).toBeCloseTo(13.7909, 3)
  })

  it('stops the rider dead on a climb with no power', () => {
    expect(steadyStateSpeed(0, 5, DEFAULT_RIDER)).toBe(0)
    expect(steadyStateSpeed(0, 0, DEFAULT_RIDER)).toBe(0)
  })

  it('goes faster for more power and slower uphill', () => {
    expect(steadyStateSpeed(300, 0, DEFAULT_RIDER)).toBeGreaterThan(
      steadyStateSpeed(200, 0, DEFAULT_RIDER),
    )
    expect(steadyStateSpeed(250, 8, DEFAULT_RIDER)).toBeLessThan(
      steadyStateSpeed(250, 2, DEFAULT_RIDER),
    )
  })

  it('costs a heavier rider a lot uphill and very little on the flat', () => {
    const heavy: RiderSettings = { ...DEFAULT_RIDER, massKg: 110 }

    // Uphill, weight is most of what you are fighting.
    const climbPenalty = 1 - steadyStateSpeed(250, 8, heavy) / steadyStateSpeed(250, 8, DEFAULT_RIDER)
    expect(climbPenalty).toBeGreaterThan(0.15)

    // On the flat it only shows up through rolling resistance, so 25 kg is
    // worth well under a km/h.
    const flatPenalty = 1 - steadyStateSpeed(250, 0, heavy) / steadyStateSpeed(250, 0, DEFAULT_RIDER)
    expect(flatPenalty).toBeGreaterThan(0)
    expect(flatPenalty).toBeLessThan(0.02)
  })
})

describe('stepMotion convergence', () => {
  // Two independent methods for the same quantity: integrating the equation
  // of motion forward, and solving it directly. They should agree, and if
  // either is wrong they will not.
  it('settles where the direct solution says it should', () => {
    const cases: [number, number][] = [
      [250, 0],
      [200, 0],
      [250, 8],
      [150, 3],
      [300, -2],
      [0, -6],
    ]
    for (const [power, gradient] of cases) {
      const settled = integrate(power, gradient, 400)
      expect(settled.speed).toBeCloseTo(steadyStateSpeed(power, gradient, DEFAULT_RIDER), 3)
    }
  })

  it('reaches the same place from above or below', () => {
    const fromRest = integrate(220, 2, 400)
    const fromFast = integrate(220, 2, 400, { from: { speed: 25, distance: 0 } })
    expect(fromFast.speed).toBeCloseTo(fromRest.speed, 3)
  })

  it('is unaffected by step size', () => {
    const coarse = integrate(250, 4, 400, { dt: 0.5 })
    const fine = integrate(250, 4, 400, { dt: 0.05 })
    expect(coarse.speed).toBeCloseTo(fine.speed, 3)
  })
})

describe('stepMotion behaviour', () => {
  it('accelerates from a standstill without a singularity', () => {
    const after = stepMotion(MOTION_AT_REST, { powerW: 200, gradientPct: 0, dtSeconds: 0.25 }, DEFAULT_RIDER)
    expect(after.speed).toBeGreaterThan(0)
    expect(after.speed).toBeLessThan(2)
    expect(Number.isFinite(after.speed)).toBe(true)
  })

  it('rolls away downhill with no power at all', () => {
    const after = integrate(0, -6, 30)
    expect(after.speed).toBeGreaterThan(5)
    expect(after.distance).toBeGreaterThan(50)
  })

  it('grinds to a halt on a climb with no power, and stays there', () => {
    const stopped = integrate(0, 8, 60, { from: { speed: 6, distance: 0 } })
    expect(stopped.speed).toBe(0)

    const stillStopped = stepMotion(stopped, { powerW: 0, gradientPct: 8, dtSeconds: 0.25 }, DEFAULT_RIDER)
    expect(stillStopped.speed).toBe(0)
    expect(stillStopped.distance).toBe(stopped.distance)
  })

  it('treats negative power as no power', () => {
    const zero = stepMotion({ speed: 5, distance: 0 }, { powerW: 0, gradientPct: 0, dtSeconds: 0.25 }, DEFAULT_RIDER)
    const negative = stepMotion({ speed: 5, distance: 0 }, { powerW: -50, gradientPct: 0, dtSeconds: 0.25 }, DEFAULT_RIDER)
    expect(negative.speed).toBe(zero.speed)
  })
})

describe('stepMotion distance', () => {
  it('accumulates at the settled speed', () => {
    const settled = integrate(250, 0, 400)
    const after = integrate(250, 0, 100, { from: { ...settled, distance: 0 } })
    expect(after.distance).toBeCloseTo(settled.speed * 100, 0)
  })

  it('covers less ground while still getting up to speed', () => {
    const fromRest = integrate(250, 0, 100)
    expect(fromRest.distance).toBeLessThan(steadyStateSpeed(250, 0, DEFAULT_RIDER) * 100)
  })

  it('never goes backwards', () => {
    let state = MOTION_AT_REST
    for (let i = 0; i < 200; i++) {
      const next = stepMotion(state, { powerW: i % 3 === 0 ? 0 : 180, gradientPct: 12, dtSeconds: 0.25 }, DEFAULT_RIDER)
      expect(next.distance).toBeGreaterThanOrEqual(state.distance)
      state = next
    }
  })
})

describe('stepMotion step guards', () => {
  it('ignores a zero or negative step', () => {
    const state = { speed: 5, distance: 100 }
    expect(stepMotion(state, { powerW: 250, gradientPct: 0, dtSeconds: 0 }, DEFAULT_RIDER)).toBe(state)
    expect(stepMotion(state, { powerW: 250, gradientPct: 0, dtSeconds: -1 }, DEFAULT_RIDER)).toBe(state)
  })

  it('caps a long stall so a backgrounded tab cannot fling the rider up the road', () => {
    const state = { speed: 5, distance: 0 }
    const input = { powerW: 250, gradientPct: 0 }
    const huge = stepMotion(state, { ...input, dtSeconds: 30 }, DEFAULT_RIDER)
    const capped = stepMotion(state, { ...input, dtSeconds: MAX_STEP_S }, DEFAULT_RIDER)
    expect(huge).toEqual(capped)
  })
})
