import { describe, expect, it } from 'vitest'
import type { RideSnapshot, RideStatus } from './engine'
import { RideRecorder } from './recorder'

function snapshot(overrides: Partial<RideSnapshot> = {}): RideSnapshot {
  return {
    status: 'riding',
    routeName: 'Test route',
    distance: 0,
    routeDistance: 1000,
    speedMs: 0,
    powerW: 0,
    targetPowerW: null,
    cadenceRpm: 0,
    gear: 12,
    gearRatio: 1,
    relativeRatio: 1,
    routeGradient: 0,
    trainerGradient: 0,
    elapsedSeconds: 0,
    elevation: 0,
    climbed: 0,
    routeAscent: 0,
    lat: 0,
    lon: 0,
    ...overrides,
  }
}

function riding(status: RideStatus, overrides: Partial<RideSnapshot> = {}): RideSnapshot {
  return snapshot({ status, ...overrides })
}

describe('RideRecorder', () => {
  it('starts empty', () => {
    const recorder = new RideRecorder()
    expect(recorder.isEmpty).toBe(true)
    expect(recorder.samples).toHaveLength(0)
    expect(recorder.startedAt).toBeNull()
  })

  it('records the first call regardless of timing', () => {
    const recorder = new RideRecorder()
    recorder.record(riding('riding'), 1_000)
    expect(recorder.samples).toHaveLength(1)
    expect(recorder.isEmpty).toBe(false)
  })

  it('throttles to at most one sample per second', () => {
    const recorder = new RideRecorder()
    recorder.record(riding('riding'), 1_000)
    recorder.record(riding('riding'), 1_500)
    recorder.record(riding('riding'), 1_999)
    expect(recorder.samples).toHaveLength(1)

    recorder.record(riding('riding'), 2_000)
    expect(recorder.samples).toHaveLength(2)
  })

  it('only records while riding', () => {
    const recorder = new RideRecorder()
    recorder.record(riding('idle'), 1_000)
    recorder.record(riding('ready'), 1_000)
    recorder.record(riding('paused'), 1_000)
    recorder.record(riding('finished'), 1_000)
    expect(recorder.samples).toHaveLength(0)
  })

  it('does not accumulate samples while paused mid-ride', () => {
    const recorder = new RideRecorder()
    recorder.record(riding('riding'), 1_000)
    recorder.record(riding('paused'), 2_000)
    recorder.record(riding('paused'), 3_000)
    recorder.record(riding('riding'), 4_000)
    expect(recorder.samples).toHaveLength(2)
  })

  it('resets samples and throttle state', () => {
    const recorder = new RideRecorder()
    recorder.record(riding('riding'), 1_000)
    recorder.reset()
    expect(recorder.samples).toHaveLength(0)
    expect(recorder.isEmpty).toBe(true)
    expect(recorder.startedAt).toBeNull()

    // Throttle state must reset too: this must record even though it is
    // less than a second after the last (discarded) sample.
    recorder.record(riding('riding'), 1_200)
    expect(recorder.samples).toHaveLength(1)
  })

  it('tracks the time of the first sample as startedAt', () => {
    const recorder = new RideRecorder()
    recorder.record(riding('riding'), 5_000)
    recorder.record(riding('riding'), 6_000)
    expect(recorder.startedAt).toBe(5_000)
  })

  it('carries the relevant snapshot fields onto the sample', () => {
    const recorder = new RideRecorder()
    recorder.record(
      riding('riding', {
        distance: 123.4,
        lat: 46.5,
        lon: 11.35,
        elevation: 620,
        powerW: 183,
        cadenceRpm: 85,
        speedMs: 8.3,
      }),
      1_000,
    )

    expect(recorder.samples[0]).toEqual({
      time: 1_000,
      distanceM: 123.4,
      lat: 46.5,
      lon: 11.35,
      altitudeM: 620,
      powerW: 183,
      cadenceRpm: 85,
      speedMs: 8.3,
    })
  })
})
