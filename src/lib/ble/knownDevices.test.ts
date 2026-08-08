import { describe, expect, it } from 'vitest'
import { NO_KNOWN_DEVICES, pick, sanitizeKnownDevices } from './knownDevices'

const device = (id: string) => ({ id }) as BluetoothDevice

describe('sanitizeKnownDevices', () => {
  it('keeps ids that look like ids', () => {
    expect(sanitizeKnownDevices({ trainer: 'abc', click: 'def', heartRate: 'ghi' })).toEqual({
      trainer: 'abc',
      click: 'def',
      heartRate: 'ghi',
    })
  })

  it('refuses anything that is not a non-empty string', () => {
    for (const value of ['', 0, 1, true, {}, [], null]) {
      expect(sanitizeKnownDevices({ trainer: value }).trainer).toBeNull()
    }
  })

  it('survives storage holding something else entirely', () => {
    for (const raw of [null, 'nonsense', 42, []]) {
      expect(sanitizeKnownDevices(raw)).toEqual(NO_KNOWN_DEVICES)
    }
  })

  it('fills in a role that was never stored', () => {
    expect(sanitizeKnownDevices({ trainer: 'abc' }).click).toBeNull()
  })
})

describe('pick', () => {
  const granted = [device('trainer-id'), device('click-id')]

  it('finds the remembered device', () => {
    expect(pick(granted, 'click-id')).toBe(granted[1])
  })

  it('returns nothing when permission was revoked', () => {
    // The id survives in storage after the rider clears the site's permissions.
    expect(pick(granted, 'forgotten-id')).toBeUndefined()
  })

  it('returns nothing when no device was ever remembered', () => {
    expect(pick(granted, null)).toBeUndefined()
  })
})
