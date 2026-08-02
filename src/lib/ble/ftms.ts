/**
 * FTMS codecs — the Bluetooth Fitness Machine Service, which is what lets this
 * talk to a Kickr, a Tacx, an Elite or anything else built to the standard.
 *
 * Pure bytes in, values out. Nothing here touches Web Bluetooth, because this
 * is the part that cannot be checked against real hardware from a test suite
 * and therefore has to be checked against the specification instead.
 */

export const FTMS_SERVICE = 0x1826
export const CYCLING_POWER_SERVICE = 0x1818

export const INDOOR_BIKE_DATA = 0x2ad2
export const FITNESS_MACHINE_FEATURE = 0x2acc
export const FITNESS_MACHINE_CONTROL_POINT = 0x2ad9
export const FITNESS_MACHINE_STATUS = 0x2ada

export const ControlOpcode = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setSimulationParameters: 0x11,
  responseCode: 0x80,
} as const

export const ControlResult = {
  success: 0x01,
  opcodeNotSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05,
} as const

const RESULT_NAMES: Record<number, string> = {
  [ControlResult.success]: 'success',
  [ControlResult.opcodeNotSupported]: 'not supported by this trainer',
  [ControlResult.invalidParameter]: 'invalid parameter',
  [ControlResult.operationFailed]: 'operation failed',
  [ControlResult.controlNotPermitted]: 'control not permitted',
}

export interface IndoorBikeData {
  speedKmh?: number
  averageSpeedKmh?: number
  cadenceRpm?: number
  averageCadenceRpm?: number
  totalDistanceM?: number
  resistanceLevel?: number
  powerW?: number
  averagePowerW?: number
  totalEnergyKcal?: number
  heartRateBpm?: number
  elapsedTimeS?: number
  remainingTimeS?: number
}

/**
 * Indoor Bike Data (0x2AD2). A uint16 flags word followed by whichever fields
 * it advertises, in a fixed order — there are no field identifiers, so the
 * only way to find the power is to walk every preceding field.
 *
 * Note bit 0 is "More Data", which is inverted: speed is present when it is
 * *clear*. Getting that backwards shifts every subsequent field by two bytes.
 *
 * A short frame stops the walk rather than throwing. Losing the tail of one
 * notification should not end a ride.
 */
export function parseIndoorBikeData(view: DataView): IndoorBikeData {
  if (view.byteLength < 2) return {}

  const flags = view.getUint16(0, true)
  const result: IndoorBikeData = {}
  let offset = 2

  const room = (bytes: number): boolean => offset + bytes <= view.byteLength

  const u16 = (): number | undefined => {
    if (!room(2)) return undefined
    const value = view.getUint16(offset, true)
    offset += 2
    return value
  }
  const i16 = (): number | undefined => {
    if (!room(2)) return undefined
    const value = view.getInt16(offset, true)
    offset += 2
    return value
  }
  const u8 = (): number | undefined => {
    if (!room(1)) return undefined
    const value = view.getUint8(offset)
    offset += 1
    return value
  }
  const u24 = (): number | undefined => {
    if (!room(3)) return undefined
    const value =
      view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
    offset += 3
    return value
  }

  const scaled = (raw: number | undefined, factor: number): number | undefined =>
    raw === undefined ? undefined : raw * factor

  if (!(flags & 0x0001)) result.speedKmh = scaled(u16(), 0.01)
  if (flags & 0x0002) result.averageSpeedKmh = scaled(u16(), 0.01)
  if (flags & 0x0004) result.cadenceRpm = scaled(u16(), 0.5)
  if (flags & 0x0008) result.averageCadenceRpm = scaled(u16(), 0.5)
  if (flags & 0x0010) result.totalDistanceM = u24()
  if (flags & 0x0020) result.resistanceLevel = i16()
  if (flags & 0x0040) result.powerW = i16()
  if (flags & 0x0080) result.averagePowerW = i16()
  if (flags & 0x0100) {
    result.totalEnergyKcal = u16()
    u16() // energy per hour
    u8() // energy per minute
  }
  if (flags & 0x0200) result.heartRateBpm = u8()
  if (flags & 0x0400) u8() // metabolic equivalent
  if (flags & 0x0800) result.elapsedTimeS = u16()
  if (flags & 0x1000) result.remainingTimeS = u16()

  return result
}

export interface SimulationParameters {
  /** Headwind in m/s. Positive is a headwind. */
  windSpeedMs?: number
  /** Coefficient of rolling resistance. */
  crr?: number
  /** Wind resistance coefficient in kg/m. */
  cw?: number
}

/**
 * Set Indoor Bike Simulation Parameters (0x11). Seven bytes: opcode, then
 * wind speed and grade as little-endian signed 16-bit, then rolling and wind
 * resistance as single bytes.
 *
 * Defaults match a road bike on tarmac. Each field is clamped to what its
 * width can hold, so an extreme gradient produces the steepest representable
 * slope rather than a wrapped-around descent.
 */
export function buildSimulationParameters(
  gradePct: number,
  { windSpeedMs = 0, crr = 0.004, cw = 0.51 }: SimulationParameters = {},
): Uint8Array {
  const frame = new Uint8Array(7)
  const view = new DataView(frame.buffer)

  view.setUint8(0, ControlOpcode.setSimulationParameters)
  view.setInt16(1, clampInt(windSpeedMs / 0.001, -32768, 32767), true)
  view.setInt16(3, clampInt(gradePct / 0.01, -32768, 32767), true)
  view.setUint8(5, clampInt(crr / 0.0001, 0, 255))
  view.setUint8(6, clampInt(cw / 0.01, 0, 255))

  return frame
}

export function buildRequestControl(): Uint8Array {
  return new Uint8Array([ControlOpcode.requestControl])
}

export function buildStart(): Uint8Array {
  return new Uint8Array([ControlOpcode.startOrResume])
}

/** Parameter 0x01 stops; 0x02 would pause. */
export function buildStop(): Uint8Array {
  return new Uint8Array([ControlOpcode.stopOrPause, 0x01])
}

export interface ControlResponse {
  /** The opcode this is answering. */
  requestOpcode: number
  result: number
  ok: boolean
  /** Human-readable reason, for surfacing a refusal to the rider. */
  reason: string
}

/** Every control point write is answered with `[0x80, opcode, result]`. */
export function parseControlResponse(view: DataView): ControlResponse | null {
  if (view.byteLength < 3) return null
  if (view.getUint8(0) !== ControlOpcode.responseCode) return null

  const requestOpcode = view.getUint8(1)
  const result = view.getUint8(2)

  return {
    requestOpcode,
    result,
    ok: result === ControlResult.success,
    reason: RESULT_NAMES[result] ?? `unknown result 0x${result.toString(16)}`,
  }
}

export interface MachineFeatures {
  /** Whether the trainer accepts opcode 0x11 — without it there is no gradient. */
  simulation: boolean
  power: boolean
  resistance: boolean
}

/** Fitness Machine Feature (0x2ACC): two little-endian uint32 bitfields. */
export function parseFeatures(view: DataView): MachineFeatures | null {
  if (view.byteLength < 8) return null
  const targets = view.getUint32(4, true)

  return {
    resistance: (targets & (1 << 2)) !== 0,
    power: (targets & (1 << 3)) !== 0,
    simulation: (targets & (1 << 13)) !== 0,
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(min, Math.round(value)))
}
