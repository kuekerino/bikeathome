import { describe, expect, it } from 'vitest'
import type { RideSnapshot } from '../ride/engine'
import type { FlatStep } from '../workout/model'
import { announcementFor, describeStatus } from './announce'

function snapshot(over: Partial<RideSnapshot> = {}): RideSnapshot {
  return {
    status: 'riding',
    mode: 'free',
    routeName: null,
    distance: 1234,
    routeDistance: 0,
    speedMs: 7.5,
    powerW: 183,
    cadenceRpm: 88,
    gear: 12,
    gearRatio: 2.4,
    relativeRatio: 1,
    routeGradient: 0,
    trainerGradient: 0,
    targetPowerW: null,
    heldPowerW: null,
    heartRateBpm: null,
    overCeiling: false,
    seenButtons: [],
    workout: null,
    elapsedSeconds: 600,
    elevation: 0,
    climbed: 0,
    routeAscent: 0,
    lat: 0,
    lon: 0,
    ...over,
  }
}

const watts = (w: number) => ({ kind: 'watts', watts: w }) as const

const step = (over: Partial<FlatStep> = {}): FlatStep => ({
  step: { seconds: 180, from: watts(300), to: watts(300) },
  startSeconds: 0,
  endSeconds: 180,
  ...over,
})

const workout = (over: Partial<NonNullable<RideSnapshot['workout']>> = {}) =>
  ({
    name: 'Session',
    elapsedSeconds: 0,
    totalSeconds: 600,
    step: step(),
    next: null,
    stepIndex: 0,
    stepCount: 4,
    blocked: false,
    finished: false,
    ...over,
  }) as NonNullable<RideSnapshot['workout']>

describe('announcementFor', () => {
  it('says nothing at all when nothing happened', () => {
    // The whole point: a dashboard read aloud continuously is unusable.
    const same = snapshot()
    expect(announcementFor(same, snapshot(), null)).toBeNull()
  })

  it('stays quiet while only the numbers move', () => {
    const before = snapshot({ powerW: 180, cadenceRpm: 88, speedMs: 7 })
    const after = snapshot({ powerW: 240, cadenceRpm: 95, speedMs: 9 })
    expect(announcementFor(before, after, null)).toBeNull()
  })

  it('announces a new interval with what to do', () => {
    const before = snapshot({ workout: workout({ stepIndex: 0 }) })
    const after = snapshot({
      workout: workout({
        stepIndex: 1,
        step: step({ repeat: { index: 2, total: 6 } }),
      }),
    })
    const said = announcementFor(before, after, null)
    expect(said).toContain('Interval 2 of 6')
    expect(said).toContain('300 W')
    expect(said).toContain('3 minutes')
  })

  it('reads a duration as words, not as a clock time', () => {
    // "3:30" gets read as half past three.
    const before = snapshot({ workout: workout({ stepIndex: 0 }) })
    const after = snapshot({
      workout: workout({
        stepIndex: 1,
        step: step({ step: { seconds: 210, from: watts(200), to: watts(200) } }),
      }),
    })
    expect(announcementFor(before, after, null)).toContain('3 minutes 30')
  })

  it('announces the workout ending', () => {
    const before = snapshot({ workout: workout({ finished: false }) })
    const after = snapshot({ workout: workout({ finished: true, step: null }) })
    expect(announcementFor(before, after, null)).toContain('Workout finished')
  })

  it('announces crossing the ceiling, and coming back under', () => {
    const under = snapshot({ heartRateBpm: 130, overCeiling: false })
    const over = snapshot({ heartRateBpm: 142, overCeiling: true })
    expect(announcementFor(under, over, null)).toContain('over the ceiling, 142')
    expect(announcementFor(over, under, null)).toContain('back under')
  })

  it('does not repeat the ceiling warning every tick', () => {
    const over = snapshot({ heartRateBpm: 142, overCeiling: true })
    expect(announcementFor(over, snapshot({ heartRateBpm: 145, overCeiling: true }), null)).toBeNull()
  })

  it('confirms a shift, because the rider asked for it', () => {
    expect(announcementFor(snapshot({ gear: 12 }), snapshot({ gear: 13 }), null)).toBe('Gear 13.')
  })

  it('says nothing about the gear while a power is held', () => {
    // It changes nothing there, so saying it would be a lie by implication.
    const before = snapshot({ gear: 12, targetPowerW: 200 })
    const after = snapshot({ gear: 13, targetPowerW: 200 })
    expect(announcementFor(before, after, null)).toBeNull()
  })

  it('announces starting, pausing and finishing', () => {
    expect(announcementFor(snapshot({ status: 'ready' }), snapshot({ status: 'riding' }), null)).toBe(
      'Riding.',
    )
    expect(announcementFor(snapshot(), snapshot({ status: 'paused' }), null)).toBe('Paused.')
    expect(announcementFor(snapshot(), snapshot({ status: 'finished' }), null)).toBe('Ride finished.')
  })

  it('has nothing to compare against on the first snapshot', () => {
    expect(announcementFor(null, snapshot(), null)).toBeNull()
  })
})

describe('describeStatus', () => {
  it('reads the numbers a rider would glance at', () => {
    const said = describeStatus(snapshot({ heartRateBpm: 132 }))
    expect(said).toContain('183 watts')
    expect(said).toContain('88 rpm')
    expect(said).toContain('132 beats')
    expect(said).toContain('27.0 kilometres per hour')
    expect(said).toContain('10 minutes elapsed')
  })

  it('leaves out a heart rate nobody is reporting', () => {
    expect(describeStatus(snapshot())).not.toContain('beats')
  })

  it('says when the ceiling is holding the effort down', () => {
    const said = describeStatus(snapshot({ targetPowerW: 200, heldPowerW: 160 }))
    expect(said).toContain('holding 160 watts, eased off from 200')
  })
})
