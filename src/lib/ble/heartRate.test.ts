import { describe, expect, it } from 'vitest'
import { parseHeartRate } from './heartRate'

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer)

describe('parseHeartRate', () => {
  it('reads an 8-bit rate', () => {
    // Flags 0x00: narrow value, no contact reporting.
    expect(parseHeartRate(view(0x00, 137))).toEqual({ bpm: 137 })
  })

  it('reads a 16-bit rate little-endian', () => {
    // Bit 0 set means the value is two bytes. Reading it as one would give 44.
    expect(parseHeartRate(view(0x01, 0x2c, 0x01))).toEqual({ bpm: 300 })
    expect(parseHeartRate(view(0x01, 0x89, 0x00))).toEqual({ bpm: 137 })
  })

  it('does not mistake a wide frame for a narrow one', () => {
    const narrow = parseHeartRate(view(0x00, 0x89, 0x00))
    const wide = parseHeartRate(view(0x01, 0x89, 0x00))
    expect(narrow).toEqual(wide)
  })

  it('reports contact only when the strap says it supports it', () => {
    // Bits 1-2: 0 and 1 mean "not supported", 2 means no contact, 3 means contact.
    expect(parseHeartRate(view(0x00, 137))).not.toHaveProperty('contact')
    expect(parseHeartRate(view(0x02, 137))).not.toHaveProperty('contact')
    expect(parseHeartRate(view(0x04, 137))).toEqual({ bpm: 137, contact: false })
    expect(parseHeartRate(view(0x06, 137))).toEqual({ bpm: 137, contact: true })
  })

  it('ignores the fields it does not need', () => {
    // Energy expended and RR intervals trail the rate; they must not disturb it.
    expect(parseHeartRate(view(0x18, 137, 0x10, 0x00, 0x20, 0x03))).toEqual({ bpm: 137 })
  })

  it('rejects a rate no heart produces', () => {
    // Zero is a strap that has not found a beat, not a heart that stopped.
    expect(parseHeartRate(view(0x00, 0))).toBeNull()
    expect(parseHeartRate(view(0x01, 0xff, 0xff))).toBeNull()
  })

  it('survives a truncated frame', () => {
    expect(parseHeartRate(view(0x00))).toBeNull()
    expect(parseHeartRate(view(0x01, 0x89))).toBeNull()
    expect(parseHeartRate(view())).toBeNull()
  })
})
