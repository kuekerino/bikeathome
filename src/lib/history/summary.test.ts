import { describe, expect, it } from 'vitest'
import type { RideSample } from '../ride/recorder'
import { formatLength, summarise, type RideContext } from './summary'

const START = Date.UTC(2026, 7, 8, 8, 50, 0)

const sample = (over: Partial<RideSample> = {}): RideSample => ({
  time: START,
  distanceM: 0,
  lat: 0,
  lon: 0,
  altitudeM: 0,
  powerW: 130,
  cadenceRpm: 88,
  speedMs: 7.4,
  ...over,
})

const context: RideContext = { routeName: null, workout: null, mode: 'free', climbedM: 0 }

describe('summarise', () => {
  const ride = [
    sample({ time: START, powerW: 100, cadenceRpm: 80 }),
    sample({ time: START + 60_000, powerW: 140, cadenceRpm: 90, distanceM: 450 }),
    sample({ time: START + 120_000, powerW: 180, cadenceRpm: 94, distanceM: 900 }),
  ]

  it('reads the length and distance off the ends', () => {
    const summary = summarise(ride, context)
    expect(summary?.seconds).toBe(120)
    expect(summary?.distanceM).toBe(900)
  })

  it('averages the effort and keeps the peak', () => {
    const summary = summarise(ride, context)
    expect(summary?.averagePowerW).toBe(140)
    expect(summary?.maxPowerW).toBe(180)
    expect(summary?.averageCadenceRpm).toBe(88)
  })

  it('keys the ride by when it started', () => {
    expect(summarise(ride, context)?.id).toBe(START)
  })

  it('averages only the samples a strap was actually reporting for', () => {
    // A strap that joins halfway would otherwise be averaged against zeros and
    // report a heart rate nobody had.
    const withStrap = [
      sample({ time: START }),
      sample({ time: START + 60_000, heartRateBpm: 130 }),
      sample({ time: START + 120_000, heartRateBpm: 140 }),
    ]
    const summary = summarise(withStrap, context)
    expect(summary?.averageHeartRateBpm).toBe(135)
    expect(summary?.maxHeartRateBpm).toBe(140)
  })

  it('leaves the heart rate out entirely when no strap was on', () => {
    const summary = summarise(ride, context)
    expect(summary).not.toHaveProperty('averageHeartRateBpm')
  })

  it('names a ride by the most specific thing that is true', () => {
    const workout = { name: '3 x 8 endurance', blocks: [] }
    expect(summarise(ride, { ...context, workout })?.name).toBe('3 x 8 endurance')
    expect(summarise(ride, { ...context, routeName: 'Stelvio' })?.name).toBe('Stelvio')
    expect(summarise(ride, context)?.name).toBe('Just pedalling')
    expect(summarise(ride, { ...context, mode: 'route' })?.name).toBe('Unnamed route')
  })

  it('remembers the workout by name, so it can be found again', () => {
    const workout = { name: 'Ramp test', blocks: [] }
    expect(summarise(ride, { ...context, workout })?.workoutName).toBe('Ramp test')
  })

  it('has nothing to summarise from an empty ride', () => {
    expect(summarise([], context)).toBeNull()
  })

  it('survives a ride of one sample', () => {
    const summary = summarise([sample()], context)
    expect(summary?.seconds).toBe(0)
    expect(summary?.averagePowerW).toBe(130)
  })
})

describe('formatLength', () => {
  it('reads as minutes under an hour and hours above', () => {
    expect(formatLength(120)).toBe('2 min')
    expect(formatLength(2401)).toBe('40 min')
    expect(formatLength(3600)).toBe('1 h 00')
    expect(formatLength(5400)).toBe('1 h 30')
  })

  it('falls back to seconds rather than saying "0 min"', () => {
    // Which is what an abandoned ride would otherwise report.
    expect(formatLength(20)).toBe('20 s')
    expect(formatLength(0)).toBe('0 s')
  })
})
