import { describe, expect, it } from 'vitest'
import { bluetoothNote, isAppleMobile, type Platform } from './browserSupport'

const IPAD_OS_18 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function platform(over: Partial<Platform> = {}): Platform {
  return {
    hasBluetooth: false,
    userAgent: MAC_CHROME,
    maxTouchPoints: 0,
    isSecureContext: true,
    ...over,
  }
}

describe('isAppleMobile', () => {
  it('sees an iPad despite it claiming to be a Mac', () => {
    // The user agents are byte-identical; only the touch points differ.
    expect(IPAD_OS_18).toBe(MAC_SAFARI)
    expect(isAppleMobile(platform({ userAgent: IPAD_OS_18, maxTouchPoints: 5 }))).toBe(true)
    expect(isAppleMobile(platform({ userAgent: MAC_SAFARI, maxTouchPoints: 0 }))).toBe(false)
  })

  it('sees an iPhone from the user agent alone', () => {
    expect(isAppleMobile(platform({ userAgent: IPHONE, maxTouchPoints: 5 }))).toBe(true)
  })

  it('does not mistake a touchscreen Windows laptop for an iPad', () => {
    const surface =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    expect(isAppleMobile(platform({ userAgent: surface, maxTouchPoints: 10 }))).toBe(false)
  })
})

describe('bluetoothNote', () => {
  it('says nothing when pairing works', () => {
    expect(bluetoothNote(platform({ hasBluetooth: true }))).toBeUndefined()
  })

  it('tells iPad riders that switching browser will not help', () => {
    const note = bluetoothNote(platform({ userAgent: IPAD_OS_18, maxTouchPoints: 5 }))
    expect(note).toMatch(/will not help/)
    // The old advice — "use Chrome or Edge" — is exactly what must not appear
    // here, because on iOS those are Safari with a different icon.
    expect(note).not.toMatch(/use Chrome or Edge/)
  })

  it('blames the missing HTTPS rather than the browser', () => {
    const note = bluetoothNote(platform({ isSecureContext: false }))
    expect(note).toMatch(/HTTPS/)
    expect(note).not.toMatch(/Safari/)
  })

  it('blames the browser on a desktop that is otherwise fine', () => {
    const note = bluetoothNote(platform({ userAgent: MAC_SAFARI }))
    expect(note).toMatch(/Chrome or Edge/)
  })

  it('prefers the platform explanation over the HTTPS one on an iPad', () => {
    // Both are true when self-hosting over plain HTTP, but only one is fixable.
    const note = bluetoothNote(
      platform({ userAgent: IPAD_OS_18, maxTouchPoints: 5, isSecureContext: false }),
    )
    expect(note).toMatch(/iPhones and iPads/)
  })

  it('always points at the demo trainer, whatever the cause', () => {
    for (const over of [
      { userAgent: IPHONE, maxTouchPoints: 5 },
      { isSecureContext: false },
      { userAgent: MAC_SAFARI },
    ]) {
      expect(bluetoothNote(platform(over))).toMatch(/demo trainer/)
    }
  })
})
