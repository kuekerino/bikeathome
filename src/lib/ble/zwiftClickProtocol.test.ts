import { describe, expect, it } from 'vitest'
import {
  ClickShiftDetector,
  parseClickMessage,
  readHandshake,
  RIDE_ON,
  type ButtonSource,
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
      plus: true,
      minus: false,
    })
    expect(parseClickMessage(bytes(0x37, 0x08, 0x01, 0x10, 0x00))).toEqual({
      kind: 'buttons',
      source: 'clickV1',
      plus: false,
      minus: true,
    })
    expect(parseClickMessage(bytes(0x37, 0x08, 0x01, 0x10, 0x01))).toEqual({
      kind: 'buttons',
      source: 'clickV1',
      plus: false,
      minus: false,
    })
  })

  it('handles both buttons at once', () => {
    expect(parseClickMessage(bytes(0x37, 0x08, 0x00, 0x10, 0x00))).toEqual({
      kind: 'buttons',
      source: 'clickV1',
      plus: true,
      minus: true,
    })
  })

  it('ignores a report carrying no button fields', () => {
    expect(parseClickMessage(bytes(0x37))).toEqual({ kind: 'ignored', type: 0x37 })
  })
})

describe('newer keypad reports', () => {
  const ALL_RELEASED = 0xffff

  it('reads a cleared bit as a press', () => {
    const upLeft = parseClickMessage(bytes(0x23, 0x08, ...varint(ALL_RELEASED & ~0x200)))
    expect(upLeft).toEqual({ kind: 'buttons', source: 'keypadV2', plus: true, minus: false })

    const downRight = parseClickMessage(bytes(0x23, 0x08, ...varint(ALL_RELEASED & ~0x4000)))
    expect(downRight).toEqual({ kind: 'buttons', source: 'keypadV2', plus: false, minus: true })
  })

  it('reads nothing pressed when every bit is set', () => {
    expect(parseClickMessage(bytes(0x23, 0x08, ...varint(ALL_RELEASED)))).toEqual({
      kind: 'buttons',
      source: 'keypadV2',
      plus: false,
      minus: false,
    })
  })

  it('accepts either side of the controller', () => {
    for (const mask of [0x200, 0x2000]) {
      const message = parseClickMessage(bytes(0x23, 0x08, ...varint(ALL_RELEASED & ~mask)))
      expect(message).toMatchObject({ plus: true })
    }
    for (const mask of [0x400, 0x4000]) {
      const message = parseClickMessage(bytes(0x23, 0x08, ...varint(ALL_RELEASED & ~mask)))
      expect(message).toMatchObject({ minus: true })
    }
  })

  it('reads a multi-byte varint bitmap', () => {
    // 0xFDFF needs three varint bytes, so this also exercises the decoder.
    const encoded = varint(0xfdff)
    expect(encoded).toHaveLength(3)
    expect(parseClickMessage(bytes(0x23, 0x08, ...encoded))).toMatchObject({ plus: true })
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
    expect(message).toEqual({ kind: 'buttons', source: 'clickV1', plus: true, minus: false })
  })

  it('survives a truncated varint', () => {
    expect(parseClickMessage(bytes(0x37, 0x08, 0xff))).toEqual({ kind: 'ignored', type: 0x37 })
  })
})

describe('ClickShiftDetector', () => {
  const press = (
    plus: boolean,
    minus: boolean,
    source: ButtonSource = 'clickV1',
  ): ClickMessage => ({
    kind: 'buttons',
    source,
    plus,
    minus,
  })

  it('does not double-shift when both report formats are interleaved', () => {
    const detector = new ClickShiftDetector()
    // One physical press, reported in the format this device led with.
    expect(detector.update(press(true, false, 'clickV1'))).toEqual([1])
    // The same press is invisible to the other format's bitmap, so taking it
    // at face value would read as a release and let the next repeat re-fire.
    expect(detector.update(press(false, false, 'keypadV2'))).toEqual([])
    expect(detector.update(press(true, false, 'clickV1'))).toEqual([])
    // Still one shift for one press.
    expect(detector.update(press(false, false, 'clickV1'))).toEqual([])
    expect(detector.update(press(true, false, 'clickV1'))).toEqual([1])
  })

  it('follows whichever format the device leads with', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update(press(true, false, 'keypadV2'))).toEqual([1])
    expect(detector.update(press(true, false, 'clickV1'))).toEqual([])
  })

  it('relearns the format after a reconnect', () => {
    const detector = new ClickShiftDetector()
    detector.update(press(true, false, 'clickV1'))
    detector.reset()
    expect(detector.update(press(true, false, 'keypadV2'))).toEqual([1])
  })

  it('shifts once per press, not once per message', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update(press(true, false))).toEqual([1])
    // The device repeats while held; holding must not run up the block.
    expect(detector.update(press(true, false))).toEqual([])
    expect(detector.update(press(true, false))).toEqual([])
    expect(detector.update(press(false, false))).toEqual([])
    expect(detector.update(press(true, false))).toEqual([1])
  })

  it('shifts down on the other button', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update(press(false, true))).toEqual([-1])
    expect(detector.update(press(false, false))).toEqual([])
  })

  it('reports both buttons pressed together', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update(press(true, true))).toEqual([1, -1])
  })

  it('ignores everything that is not a button report', () => {
    const detector = new ClickShiftDetector()
    expect(detector.update({ kind: 'battery', percent: 50 })).toEqual([])
    expect(detector.update({ kind: 'keepalive' })).toEqual([])
  })

  // Reconnecting while a button happened to be down should not shift.
  it('forgets held buttons on reset', () => {
    const detector = new ClickShiftDetector()
    detector.update(press(true, false))
    detector.reset()
    expect(detector.update(press(true, false))).toEqual([1])
  })
})
