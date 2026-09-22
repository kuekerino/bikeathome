/**
 * Every button on a Zwift Ride, from the bytes on the wire to the action.
 *
 * The unit tests either side of this one each cover a step; this one covers
 * the join, because that is where the bug lived that made the shifter do
 * nothing at all. The frames are the ones the device really sends, so a change
 * that reads them differently fails here rather than on a turbo.
 */

import { describe, expect, it } from 'vitest'
import { ClickShiftDetector, parseClickMessage } from './zwiftClickProtocol'
import { actionForButton, DEFAULT_BINDINGS } from '../controls/bindings'
import type { RideAction } from '../controls/actions'

/**
 * A keypad report: message 0x23, a five-byte varint holding 32 bits, then four
 * length-delimited sub-messages carrying the analog buttons. Only the first
 * three varint bytes vary, because only they hold buttons — a cleared bit is a
 * button held down.
 */
const frame = (first: number, second: number, third: number) =>
  Uint8Array.from([
    0x23, 0x08, first, second, third, 0xff, 0x0f,
    0x1a, 0x04, 0x08, 0x00, 0x10, 0x00,
    0x1a, 0x04, 0x08, 0x01, 0x10, 0x00,
    0x1a, 0x04, 0x08, 0x02, 0x10, 0x00,
    0x1a, 0x04, 0x08, 0x03, 0x10, 0x00,
  ])

/** Nothing held: all 32 bits set. This is what the sign bug choked on. */
const IDLE = frame(0xff, 0xff, 0xff)

/** Every button, in bit order, with the byte value its press produces. */
const BUTTONS: Array<[name: string, frame: Uint8Array, id: string]> = [
  ['left half, left arrow', frame(0xfe, 0xff, 0xff), 'v2:0x1'],
  ['left half, up', frame(0xfd, 0xff, 0xff), 'v2:0x2'],
  ['left half, right arrow', frame(0xfb, 0xff, 0xff), 'v2:0x4'],
  ['left half, down', frame(0xf7, 0xff, 0xff), 'v2:0x8'],
  ['right half, A', frame(0xef, 0xff, 0xff), 'v2:0x10'],
  ['right half, B', frame(0xdf, 0xff, 0xff), 'v2:0x20'],
  ['right half, Y', frame(0xbf, 0xff, 0xff), 'v2:0x40'],
  ['right half, Z', frame(0xff, 0xfe, 0xff), 'v2:0x80'],
  ['left hood, upper', frame(0xff, 0xfd, 0xff), 'v2:0x100'],
  ['left hood, middle', frame(0xff, 0xfb, 0xff), 'v2:0x200'],
  ['left hood, lower', frame(0xff, 0xf7, 0xff), 'v2:0x400'],
  ['left half, power', frame(0xff, 0xef, 0xff), 'v2:0x800'],
  ['right hood, upper', frame(0xff, 0xdf, 0xff), 'v2:0x1000'],
  ['right hood, middle', frame(0xff, 0xbf, 0xff), 'v2:0x2000'],
  ['right hood, lower', frame(0xff, 0xff, 0xfe), 'v2:0x4000'],
  ['right half, power', frame(0xff, 0xff, 0xfd), 'v2:0x8000'],
]

/** One press and release, as the device reports it. */
function press(detector: ClickShiftDetector, pressed: Uint8Array): string[] {
  const ids = detector.update(parseClickMessage(pressed))
  detector.update(parseClickMessage(IDLE))
  return ids
}

describe('a Zwift Ride, press by press', () => {
  it('gives every button an id of its own', () => {
    const detector = new ClickShiftDetector()
    detector.update(parseClickMessage(IDLE))

    // Named one by one rather than asserted in a loop, so a failure says which
    // button stopped working instead of only that one did.
    const reported = BUTTONS.map(([name, pressed]) => [name, press(detector, pressed)] as const)
    expect(reported).toEqual(BUTTONS.map(([name, , id]) => [name, [id]]))
  })

  it('shifts with the six side buttons and leaves the rest to the rider', () => {
    const actions = new Map<string, RideAction>(
      BUTTONS.map(([name, , id]) => [name, actionForButton(DEFAULT_BINDINGS, id)]),
    )

    expect([...actions].filter(([, action]) => action !== 'nothing')).toEqual([
      ['left hood, upper', 'shiftDown'],
      ['left hood, middle', 'shiftDown'],
      ['left hood, lower', 'shiftDown'],
      ['right hood, upper', 'shiftUp'],
      ['right hood, middle', 'shiftUp'],
      ['right hood, lower', 'shiftUp'],
    ])
  })

  it('shifts once per press, not once per frame while held', () => {
    const detector = new ClickShiftDetector()
    detector.update(parseClickMessage(IDLE))

    const held = frame(0xff, 0xbf, 0xff)
    expect(detector.update(parseClickMessage(held))).toEqual(['v2:0x2000'])
    expect(detector.update(parseClickMessage(held))).toEqual([])
    expect(detector.update(parseClickMessage(IDLE))).toEqual([])
    expect(detector.update(parseClickMessage(held))).toEqual(['v2:0x2000'])
  })
})
