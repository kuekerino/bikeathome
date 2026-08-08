import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings'

describe('sanitizeSettings', () => {
  it('falls back to defaults for anything that is not an object', () => {
    for (const junk of [null, undefined, 42, 'settings', []]) {
      expect(sanitizeSettings(junk)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('keeps sensible values', () => {
    const settings = sanitizeSettings({
      rider: { massKg: 72, crr: 0.005, cda: 0.32 },
      drivetrain: { mode: 'cassette', chainringTeeth: 50, cogTeeth: 11 },
    })
    expect(settings.rider).toEqual({ massKg: 72, crr: 0.005, cda: 0.32 })
    expect(settings.drivetrain).toEqual({
      mode: 'cassette',
      chainringTeeth: 50,
      cogTeeth: 11,
    })
  })

  it('replaces missing fields rather than dropping them', () => {
    const settings = sanitizeSettings({ rider: { massKg: 70 } })
    expect(settings.rider.massKg).toBe(70)
    expect(settings.rider.crr).toBe(DEFAULT_SETTINGS.rider.crr)
    expect(settings.drivetrain).toEqual(DEFAULT_SETTINGS.drivetrain)
  })

  // A NaN mass propagates silently through every force calculation and turns
  // the whole dashboard into "NaN" with no clue where it came from.
  it('rejects values that would poison the physics', () => {
    const settings = sanitizeSettings({
      rider: { massKg: Number.NaN, crr: Number.POSITIVE_INFINITY, cda: 'wide' },
    })
    expect(settings.rider).toEqual(DEFAULT_SETTINGS.rider)
  })

  it('clamps values to something rideable', () => {
    const settings = sanitizeSettings({
      rider: { massKg: 5000, crr: -1, cda: 0 },
      drivetrain: { chainringTeeth: 900, cogTeeth: 0 },
    })
    expect(settings.rider.massKg).toBe(250)
    expect(settings.rider.crr).toBe(0.001)
    expect(settings.rider.cda).toBe(0.15)
    expect(settings.drivetrain.chainringTeeth).toBe(60)
    expect(settings.drivetrain.cogTeeth).toBe(8)
  })

  it('rounds tooth counts, which are whole by nature', () => {
    const settings = sanitizeSettings({ drivetrain: { chainringTeeth: 34.6, cogTeeth: 13.2 } })
    expect(settings.drivetrain.chainringTeeth).toBe(35)
    expect(settings.drivetrain.cogTeeth).toBe(13)
  })

  it('only accepts drivetrain modes it knows', () => {
    expect(sanitizeSettings({ drivetrain: { mode: 'cassette' } }).drivetrain.mode).toBe('cassette')
    expect(sanitizeSettings({ drivetrain: { mode: 'nonsense' } }).drivetrain.mode).toBe('virtual')
  })
})

describe('control bindings', () => {
  it('gives the defaults to settings stored before bindings existed', () => {
    expect(sanitizeSettings({ rider: { massKg: 80 } }).bindings.click).toEqual({
      up: 'shiftUp',
      down: 'shiftDown',
    })
  })

  it('carries a swapped Click across from the setting it replaced', () => {
    // Someone who ticked the old checkbox should not have to find the new
    // control to get their shifting back.
    expect(sanitizeSettings({ shifter: { swapButtons: true } }).bindings.click).toEqual({
      up: 'shiftDown',
      down: 'shiftUp',
    })
  })

  it('prefers real bindings over the setting they replaced', () => {
    const settings = sanitizeSettings({
      shifter: { swapButtons: true },
      bindings: { click: { up: 'powerUp10', down: 'powerDown10' } },
    })
    expect(settings.bindings.click).toEqual({ up: 'powerUp10', down: 'powerDown10' })
  })
})

describe('heart rate ceiling', () => {
  it('has no ceiling until one is set', () => {
    expect(sanitizeSettings({}).heartRateCap.ceilingBpm).toBeNull()
  })

  it('keeps a plausible ceiling', () => {
    expect(sanitizeSettings({ heartRateCap: { ceilingBpm: 137 } }).heartRateCap.ceilingBpm).toBe(
      137,
    )
  })

  it('treats zero and nonsense as no ceiling rather than as a number', () => {
    // A ceiling of 0 would fire permanently; NaN would fire never.
    for (const ceilingBpm of [0, -10, NaN, 'high', null, {}]) {
      expect(sanitizeSettings({ heartRateCap: { ceilingBpm } }).heartRateCap.ceilingBpm).toBeNull()
    }
  })

  it('clamps a ceiling no heart reaches', () => {
    expect(sanitizeSettings({ heartRateCap: { ceilingBpm: 900 } }).heartRateCap.ceilingBpm).toBe(
      220,
    )
  })

  it('backs off by default, and only a real false turns it off', () => {
    expect(sanitizeSettings({}).heartRateCap.autoBackOff).toBe(true)
    expect(
      sanitizeSettings({ heartRateCap: { autoBackOff: false } }).heartRateCap.autoBackOff,
    ).toBe(false)
    expect(sanitizeSettings({ heartRateCap: { autoBackOff: 0 } }).heartRateCap.autoBackOff).toBe(
      true,
    )
  })
})
