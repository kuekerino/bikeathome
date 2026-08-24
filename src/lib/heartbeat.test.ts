import { describe, expect, it } from 'vitest'
import { beatSeconds } from './heartbeat'

describe('beatSeconds', () => {
  it('is one beat of the actual rate', () => {
    expect(beatSeconds(60)).toBeCloseTo(1)
    expect(beatSeconds(120)).toBeCloseTo(0.5)
    expect(beatSeconds(132)).toBeCloseTo(0.4545, 3)
  })

  it('refuses to flicker at a rate no heart reaches', () => {
    // A strap glitching to 250 would otherwise be a strobe, not a pulse.
    expect(beatSeconds(250)).toBe(0.25)
    expect(beatSeconds(1000)).toBe(0.25)
  })

  it('refuses to look stopped at the bottom', () => {
    expect(beatSeconds(20)).toBe(1.5)
  })

  it('survives nonsense rather than producing an invalid duration', () => {
    expect(beatSeconds(0)).toBe(1)
    expect(beatSeconds(-5)).toBe(1)
    expect(beatSeconds(NaN)).toBe(1)
  })
})
