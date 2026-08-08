import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HEART_RATE_CAP,
  isOverCeiling,
  nextAppliedPower,
  type HeartRateCapSettings,
} from './heartRateCap'

const capped: HeartRateCapSettings = { ...DEFAULT_HEART_RATE_CAP, ceilingBpm: 137 }

const step = (over: Partial<Parameters<typeof nextAppliedPower>[0]>, s = capped) =>
  nextAppliedPower(
    { chosenW: 145, appliedW: 145, heartRateBpm: 130, dtSeconds: 1, ...over },
    s,
  )

describe('nextAppliedPower', () => {
  it('leaves the target alone while the rate is under the ceiling', () => {
    expect(step({ heartRateBpm: 130 })).toBe(145)
  })

  it('backs off while the rate is over', () => {
    expect(step({ heartRateBpm: 142 })).toBeLessThan(145)
  })

  it('comes down faster than it goes back up', () => {
    // Overshooting the ceiling is the failure being prevented; a slow recovery
    // of the target is not a failure at all.
    const fall = 145 - step({ heartRateBpm: 142 })
    const rise = step({ heartRateBpm: 120, appliedW: 100 }) - 100
    expect(fall).toBeGreaterThan(rise)
  })

  it('holds inside the deadband instead of hunting', () => {
    // One beat under the ceiling is not "recovered"; recovering there would
    // sit the rider on the limit, alternating.
    expect(step({ heartRateBpm: 136, appliedW: 100 })).toBe(100)
  })

  it('recovers once well clear of the ceiling', () => {
    expect(step({ heartRateBpm: 125, appliedW: 100 })).toBeGreaterThan(100)
  })

  it('never climbs past what the rider asked for', () => {
    expect(step({ heartRateBpm: 100, appliedW: 145 })).toBe(145)
    expect(step({ heartRateBpm: 100, appliedW: 200 })).toBe(145)
  })

  it('never falls through the floor', () => {
    const settings = { ...capped, floorW: 80 }
    let applied = 145
    for (let i = 0; i < 200; i++) {
      applied = nextAppliedPower(
        { chosenW: 145, appliedW: applied, heartRateBpm: 180, dtSeconds: 1 },
        settings,
      )
    }
    expect(applied).toBe(80)
  })

  it('keeps the floor below the target when the target is lower than the floor', () => {
    // Asking for 50 W with a 60 W floor must not raise the effort to 60.
    const settings = { ...capped, floorW: 60 }
    expect(nextAppliedPower(
      { chosenW: 50, appliedW: 50, heartRateBpm: 180, dtSeconds: 1 },
      settings,
    )).toBe(50)
  })

  it('releases the hold-back when the strap goes away', () => {
    // Otherwise unpairing mid-ride would leave the effort suppressed forever.
    expect(step({ heartRateBpm: null, appliedW: 90 })).toBe(145)
  })

  it('releases the hold-back when auto back-off is switched off', () => {
    const settings = { ...capped, autoBackOff: false }
    expect(step({ heartRateBpm: 180, appliedW: 90 }, settings)).toBe(145)
  })

  it('does nothing at all with no ceiling set', () => {
    expect(step({ heartRateBpm: 190, appliedW: 145 }, DEFAULT_HEART_RATE_CAP)).toBe(145)
  })

  it('settles rather than oscillating around the ceiling', () => {
    // Crude closed loop: heart rate follows power with a lag, as it does in a
    // rider. The target should stop moving, not hunt.
    let applied = 200
    let bpm = 150
    const history: number[] = []
    for (let i = 0; i < 300; i++) {
      // Every watt over 130 costs roughly a beat, approached slowly.
      const settled = 110 + (applied - 130) * 0.25
      bpm += (settled - bpm) * 0.05
      applied = nextAppliedPower(
        { chosenW: 200, appliedW: applied, heartRateBpm: bpm, dtSeconds: 1 },
        capped,
      )
      history.push(applied)
    }
    const tail = history.slice(-30)
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(5)
  })
})

describe('isOverCeiling', () => {
  it('is only true when there is both a reading and a ceiling', () => {
    expect(isOverCeiling(150, capped)).toBe(true)
    expect(isOverCeiling(130, capped)).toBe(false)
    expect(isOverCeiling(null, capped)).toBe(false)
    expect(isOverCeiling(200, DEFAULT_HEART_RATE_CAP)).toBe(false)
  })
})
