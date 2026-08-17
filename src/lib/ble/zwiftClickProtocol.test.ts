import { describe, expect, it } from 'vitest'
import {
  ClickShiftDetector,
  parseClickMessage,
  readHandshake,
  RIDE_ON,
  type ClickMessage,
} from './zwiftClickProtocol'

const bytes = (...values: number[]) => Uint8Array.from(values)

/** Protobuf varint, so the bitmap fixtures below are not hand-computed. */
function varint(value: number): number[] {
  const out: number[] = []
  let remaining = value
  do {
    const byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    out.push(remaining > 0 ? byte | 0x80 : byte)
  } while (remaining > 0)
  return out
}

describe('RIDE_ON', () => {
  it('is exactly the six ASCII bytes, with nothing appended', () => {
    expect(new TextDecoder().decode(RIDE_ON)).toBe('RideOn')
    expect([...RIDE_ON]).toEqual([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e])
  })
})

describe('readHandshake', () => {
  it('accepts a bare RideOn', () => {
    expect(readHandshake(RIDE_ON)).toBe('unencrypted')
  })

  it('accepts the newer firmware reply', () => {
    expect(readHandshake(bytes(...RIDE_ON, 0x02, 0x03))).toBe('unencrypted')
  })

  // Seeing this means we asked for encryption, which we never should.
  it('recognises the encrypted-mode reply as a problem', () => {
    expect(readHandshake(bytes(...RIDE_ON, 0x01, 0x03, 0xaa, 0xbb))).toBe('encrypted')
  })

  it('rejects anything else', () => {
    expect(readHandshake(bytes(0x01, 0x02, 0x03))).toBe('unrecognised')
    expect(readHandshake(bytes(0x52, 0x69, 0x64, 0x65, 0x4f, 0x6f))).toBe('unrecognised')
    expect(readHandshake(bytes())).toBe('unrecognised')
  })
})

describe('original Click button reports', () => {
  // Captured vectors. Zero means pressed, which is worth stating twice.
  it('reads the documented vectors', () => {
    expect(parseClickMessage(bytes(0x37, 0x08, 0x00, 0x10, 0x01))).toEqual({
      kind: 'buttons',
      source: 'clickV1',
      pressed: ['v1:1'],
    })
    expect(parseClickMessage(bytes(0x37, 0x08, 0x01, 0x10, 0x00))).toEqual({
      kind: 'buttons',
      source: 'clickV1',
      pressed: ['v1:2'],
    })
    expect(parseClickMessage(bytes(0x37, 0x08, 0x01, 0x10, 0x01))).toEqual({
      kind: 'buttons',
      source: 'clickV1',
      pressed: [],
    })
  })

  it('handles both buttons at once', () => {
    expect(parseClickMessage(bytes(0x37, 0x08, 0x00, 0x10, 0x00))).toEqual({
      kind: 'buttons',
      source: 'clickV1',
      pressed: ['v1:1', 'v1:2'],
    })
  })

  it('ignores a report carrying no button fields', () => {
    expect(parseClickMessage(bytes(0x37))).toEqual({ kind: 'ignored', type: 0x37 })
  })
})

describe('newer keypad reports', () => {
  const ALL_RELEASED = 0xffff

  // The parse hands the bitmap on untouched: which bits are buttons cannot be
  // told from a single frame, so that decision belongs to the detector.
  it('passes the bitmap through', () => {
    expect(parseClickMessage(bytes(0x23, 0x08, ...varint(ALL_RELEASED & ~0x200)))).toEqual({
      kind: 'buttons',
      source: 'keypadV2',
      bitmap: 0xfdff,
    })
  })

  it('reads a multi-byte varint bitmap', () => {
    // 0xFDFF needs three varint bytes, so this also exercises the decoder.
    const encoded = varint(0xfdff)
    expect(encoded).toHaveLength(3)
    expect(parseClickMessage(bytes(0x23, 0x08, ...encoded))).toMatchObject({ bitmap: 0xfdff })
  })

  it('ignores a report with no bitmap at all', () => {
    expect(parseClickMessage(bytes(0x23))).toEqual({ kind: 'ignored', type: 0x23 })
  })
})

describe('other messages', () => {
  it('reads the battery level from field 2', () => {
    expect(parseClickMessage(bytes(0x19, 0x08, 0x01, 0x10, 0x57))).toEqual({
      kind: 'battery',
      percent: 87,
    })
  })

  it('clamps an implausible battery level', () => {
    expect(parseClickMessage(bytes(0x19, 0x10, ...varint(250)))).toEqual({
      kind: 'battery',
      percent: 100,
    })
  })

  it('recognises keepalives and disconnects', () => {
    expect(parseClickMessage(bytes(0x15))).toEqual({ kind: 'keepalive' })
    expect(parseClickMessage(bytes(0xfe))).toEqual({ kind: 'disconnect' })
  })

  it('ignores messages it does not know', () => {
    expect(parseClickMessage(bytes(0x42, 0x08, 0x01))).toEqual({ kind: 'ignored', type: 0x42 })
    expect(parseClickMessage(bytes())).toEqual({ kind: 'ignored', type: -1 })
  })

  it('keeps whatever it read before a malformed field', () => {
    // Field 1 is a varint; the 0x0a tag that follows is length-delimited, so
    // the walk should stop there rather than misread the rest.
    const message = parseClickMessage(bytes(0x37, 0x08, 0x00, 0x0a, 0x02, 0xff, 0xff))
    expect(message).toEqual({ kind: 'buttons', source: 'clickV1', pressed: ['v1:1'] })
  })

  it('survives a truncated varint', () => {
    expect(parseClickMessage(bytes(0x37, 0x08, 0xff))).toEqual({ kind: 'ignored', type: 0x37 })
  })
})

describe('ClickShiftDetector', () => {
  /** A clickV1 report, which names its buttons directly. */
  const v1 = (...pressed: string[]): ClickMessage => ({
    kind: 'buttons',
    source: 'clickV1',
    pressed,
  })

  /** A keypadV2 report: every button bit set except the ones held down. */
  const v2 = (all: number, ...down: number[]): ClickMessage => ({
    kind: 'buttons',
    source: 'keypadV2',
    bitmap: down.reduce((map, bit) => map & ~bit, all),
  })

  it('does not double-report when both formats are interleaved', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update(v1('v1:1'))).toEqual(['v1:1'])
    // The same press is invisible to the other format, so taking it at face
    // value would read as a release and let the next repeat re-fire.
    expect(detector.update(v2(0xffff))).toEqual([])
    expect(detector.update(v1('v1:1'))).toEqual([])
    expect(detector.update(v1())).toEqual([])
    expect(detector.update(v1('v1:1'))).toEqual(['v1:1'])
  })

  it('follows whichever format the device leads with', () => {
    const detector = new ClickShiftDetector()
    detector.update(v2(0xffff))
    expect(detector.update(v2(0xffff, 0x200))).toEqual(['v2:0x200'])
    expect(detector.update(v1('v1:1'))).toEqual([])
  })

  it('relearns the format after a reconnect', () => {
    const detector = new ClickShiftDetector()
    detector.update(v1('v1:1'))
    detector.reset()
    detector.update(v2(0xffff))
    expect(detector.update(v2(0xffff, 0x200))).toEqual(['v2:0x200'])
  })

  it('reports once per press, not once per message', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update(v1('v1:1'))).toEqual(['v1:1'])
    // The device repeats while held; holding must not run up the block.
    expect(detector.update(v1('v1:1'))).toEqual([])
    expect(detector.update(v1('v1:1'))).toEqual([])
    expect(detector.update(v1())).toEqual([])
    expect(detector.update(v1('v1:1'))).toEqual(['v1:1'])
  })

  it('ignores bits the device never sends', () => {
    // The bug this exists for: a device with a narrow bitmap leaves every
    // higher bit at zero, which is indistinguishable from a button held down.
    // Treating those as real made two buttons appear to do the same thing.
    const detector = new ClickShiftDetector()
    // At rest this unit sends 0x0FFF: nothing above bit 11 exists on it.
    expect(detector.update(v2(0x0fff))).toEqual([])
    expect(detector.update(v2(0x0fff, 0x200))).toEqual(['v2:0x200'])
    expect(detector.update(v2(0x0fff))).toEqual([])
    expect(detector.update(v2(0x0fff, 0x400))).toEqual(['v2:0x400'])
  })

  it('learns a button the first time it is released, not pressed', () => {
    // If the very first frame arrives with a button already down, that bit has
    // never been seen set, so it cannot yet be told apart from padding.
    const detector = new ClickShiftDetector()
    expect(detector.update(v2(0x0fff, 0x200))).toEqual([])
    expect(detector.update(v2(0x0fff))).toEqual([])
    expect(detector.update(v2(0x0fff, 0x200))).toEqual(['v2:0x200'])
  })

  it('reports both buttons separately when both are held', () => {
    const detector = new ClickShiftDetector()
    detector.update(v2(0x0fff))
    expect(detector.update(v2(0x0fff, 0x200, 0x400)).sort()).toEqual(['v2:0x200', 'v2:0x400'])
  })

  it('reports the other button separately', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update(v1('v1:2'))).toEqual(['v1:2'])
    expect(detector.update(v1())).toEqual([])
  })

  it('reports both buttons pressed together', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update(v1('v1:1', 'v1:2'))).toEqual(['v1:1', 'v1:2'])
  })

  it('ignores everything that is not a button report', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update({ kind: 'battery', percent: 50 })).toEqual([])
    expect(detector.update({ kind: 'keepalive' })).toEqual([])
  })

  // Reconnecting while a button happened to be down should not shift.
  it('forgets held buttons on reset', () => {
    const detector = new ClickShiftDetector()
    detector.update(v1('v1:1'))
    detector.reset()
    expect(detector.update(v1('v1:1'))).toEqual(['v1:1'])
  })
})
