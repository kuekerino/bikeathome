/**
 * Zwift Click wire protocol.
 *
 * Zwift never published this; it comes from the reverse-engineering work in
 * ajchellew/zwiftplay and jat255/Zwift_click_handling. The device speaks
 * protobuf-shaped messages, but only ever with varint fields, so a couple of
 * dozen lines read them without a protobuf runtime.
 *
 * Pure bytes in, meaning out. The Web Bluetooth plumbing lives next door.
 */

/** Original Click. The characteristics live directly under this service. */
export const ZWIFT_SERVICE_V1 = '00000001-19ca-4651-86e5-fa29dcdd09d1'

/** Newer firmware moved the same three characteristics under a 16-bit service. */
export const ZWIFT_SERVICE_V2 = 0xfc82

/** Buttons and battery arrive here. */
export const ZWIFT_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1'
/** The handshake is written here. */
export const ZWIFT_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1'
/** The handshake is answered here. */
export const ZWIFT_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1'

/**
 * The whole handshake: six ASCII bytes and nothing else. Appending the
 * request-start bytes and a public key is what puts the device into encrypted
 * mode, so the trick to staying in the clear is simply not to.
 */
export const RIDE_ON = Uint8Array.from([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e])

const MessageType = {
  /** Original Click button report. */
  clickV1: 0x37,
  /** Newer keypad report, shared with the Zwift Ride. */
  keypadV2: 0x23,
  battery: 0x19,
  keepalive: 0x15,
  disconnect: 0xfe,
} as const

/**
 * Button masks in the newer keypad report, where a *cleared* bit means
 * pressed. These are the Zwift Ride's four shift buttons; a Click v2 uses a
 * subset, and which subset is not firmly established — hence the keyboard
 * staying available as a fallback whatever happens.
 */
const ShiftMask = {
  upLeft: 0x200,
  downLeft: 0x400,
  upRight: 0x2000,
  downRight: 0x4000,
} as const

/** Which report format a button message arrived in. */
export type ButtonSource = 'clickV1' | 'keypadV2'

export type ClickMessage =
  | { kind: 'buttons'; source: ButtonSource; plus: boolean; minus: boolean }
  | { kind: 'battery'; percent: number }
  | { kind: 'keepalive' }
  | { kind: 'disconnect' }
  | { kind: 'ignored'; type: number }

export type HandshakeResult = 'unencrypted' | 'encrypted' | 'unrecognised'

/**
 * A reply beginning "RideOn" means the device accepted us. The `01 03` tail is
 * the device offering its public key, which only happens if we asked for
 * encryption — so seeing it means the handshake went wrong somewhere.
 */
export function readHandshake(bytes: Uint8Array): HandshakeResult {
  if (bytes.length < RIDE_ON.length) return 'unrecognised'
  for (const [i, expected] of RIDE_ON.entries()) {
    if (bytes[i] !== expected) return 'unrecognised'
  }

  const tail = bytes.subarray(RIDE_ON.length)
  return tail[0] === 0x01 && tail[1] === 0x03 ? 'encrypted' : 'unencrypted'
}

export function parseClickMessage(bytes: Uint8Array): ClickMessage {
  const type = bytes[0]
  if (type === undefined) return { kind: 'ignored', type: -1 }

  const fields = readVarintFields(bytes.subarray(1))

  switch (type) {
    case MessageType.clickV1: {
      // Zero means pressed here, which is the opposite of the obvious reading.
      const plus = fields.get(1)
      const minus = fields.get(2)
      if (plus === undefined && minus === undefined) return { kind: 'ignored', type }
      return { kind: 'buttons', source: 'clickV1', plus: plus === 0, minus: minus === 0 }
    }

    case MessageType.keypadV2: {
      const map = fields.get(1)
      if (map === undefined) return { kind: 'ignored', type }
      const pressed = (mask: number) => (map & mask) === 0
      return {
        kind: 'buttons',
        source: 'keypadV2',
        plus: pressed(ShiftMask.upLeft) || pressed(ShiftMask.upRight),
        minus: pressed(ShiftMask.downLeft) || pressed(ShiftMask.downRight),
      }
    }

    case MessageType.battery: {
      const percent = fields.get(2)
      return percent === undefined
        ? { kind: 'ignored', type }
        : { kind: 'battery', percent: Math.min(100, Math.max(0, percent)) }
    }

    case MessageType.keepalive:
      return { kind: 'keepalive' }

    case MessageType.disconnect:
      return { kind: 'disconnect' }

    default:
      return { kind: 'ignored', type }
  }
}

/**
 * Turns a stream of button reports into shifts.
 *
 * The device repeats the same message while a button is held, so shifting on
 * every message would run through the whole block from one press. Only the
 * released-to-pressed edge counts.
 *
 * A device that speaks both report formats will interleave them, and the two
 * disagree: a press reported as `clickV1` is invisible in the `keypadV2`
 * bitmap, which therefore reads as released. Tracking one held-state across
 * both makes a single press look like press, release, press — two shifts from
 * one click, intermittently, depending on how the reports interleave. So the
 * first format seen wins and the other is ignored for the rest of the session.
 */
export class ClickShiftDetector {
  private plus = false
  private minus = false
  private source: ButtonSource | null = null

  update(message: ClickMessage): (1 | -1)[] {
    if (message.kind !== 'buttons') return []

    this.source ??= message.source
    if (message.source !== this.source) return []

    const shifts: (1 | -1)[] = []
    if (message.plus && !this.plus) shifts.push(1)
    if (message.minus && !this.minus) shifts.push(-1)

    this.plus = message.plus
    this.minus = message.minus
    return shifts
  }

  /** Forget held buttons, so a reconnect cannot fire a phantom shift. */
  reset(): void {
    this.plus = false
    this.minus = false
    this.source = null
  }
}

/**
 * Reads `field: value` pairs where every value is a varint. Anything else —
 * a length-delimited field, a truncated message — stops the walk and keeps
 * whatever was read before it.
 */
function readVarintFields(bytes: Uint8Array): Map<number, number> {
  const fields = new Map<number, number>()
  const cursor = { offset: 0 }

  while (cursor.offset < bytes.length) {
    const tag = readVarint(bytes, cursor)
    if (tag === null || (tag & 0x07) !== 0) break

    const value = readVarint(bytes, cursor)
    if (value === null) break

    fields.set(tag >>> 3, value)
  }

  return fields
}

function readVarint(bytes: Uint8Array, cursor: { offset: number }): number | null {
  let result = 0
  let shift = 0

  while (cursor.offset < bytes.length) {
    const byte = bytes[cursor.offset]!
    cursor.offset += 1
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return result >>> 0
    shift += 7
    // Past 32 bits nothing here is meaningful, and the shift itself wraps.
    if (shift > 28) return null
  }

  return null
}
