import { describe, expect, it } from 'vitest'

import type { RideSnapshot } from '../ride/engine'
import { isFromView, rideUpdate } from './protocol'

const snapshot = {
  status: 'riding',
  distance: 1234.5,
  routeDistance: 72470,
  speedMs: 8.2,
  powerW: 210,
  cadenceRpm: 88,
  routeGradient: 4.2,
  trainerGradient: 6.1,
  gear: 14,
  targetPowerW: 220,
  heldPowerW: 205,
  heartRateBpm: 141,
} as RideSnapshot

describe('rideUpdate', () => {
  it('passes on what the view needs, with the road gradient rather than the trainer gradient', () => {
    expect(rideUpdate(snapshot, true)).toEqual({
      type: 'ride',
      status: 'riding',
      distance: 1234.5,
      routeDistance: 72470,
      speedMs: 8.2,
      powerW: 210,
      cadenceRpm: 88,
      gradient: 4.2,
      gear: 14,
      targetPowerW: 205,
      heartRateBpm: 141,
    })
  })

  it('has no gear to show in cassette mode', () => {
    expect(rideUpdate(snapshot, false).gear).toBeNull()
  })
})

describe('isFromView', () => {
  const event = (origin: string, data: unknown) => ({ origin, data }) as MessageEvent

  it('listens only to its own origin', () => {
    expect(isFromView(event('https://a.example', { type: 'ready' }), 'https://a.example')).toBe(true)
    expect(isFromView(event('https://b.example', { type: 'ready' }), 'https://a.example')).toBe(false)
    expect(isFromView(event('https://a.example', 'ready'), 'https://a.example')).toBe(false)
  })
})
