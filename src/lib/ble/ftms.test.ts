import { describe, expect, it } from 'vitest'
import {
  buildRequestControl,
  buildSimulationParameters,
  buildStart,
  buildStop,
  ControlOpcode,
  parseControlResponse,
  parseFeatures,
  parseIndoorBikeData,
} from './ftms'

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer)
const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')

describe('buildSimulationParameters', () => {
  // The reference frame: 4.5% grade, no wind, road defaults. If this byte
  // sequence is wrong the trainer either ignores us or simulates the wrong
  // hill, and neither is visible from here.
  it('encodes the reference frame exactly', () => {
    expect(hex(buildSimulationParameters(4.5))).toBe('11 00 00 c2 01 28 33')
  })

  it('opens with the simulation opcode and is seven bytes', () => {
    const frame = buildSimulationParameters(0)
    expect(frame).toHaveLength(7)
    expect(frame[0]).toBe(ControlOpcode.setSimulationParameters)
  })

  it('encodes grade little-endian in hundredths of a percent', () => {
    expect(hex(buildSimulationParameters(1)).slice(9, 14)).toBe('64 00')
    expect(hex(buildSimulationParameters(0))).toBe('11 00 00 00 00 28 33')
  })

  it('encodes descents as a negative grade', () => {
    // -4.5% => -450 => 0xFE3E little-endian
    expect(hex(buildSimulationParameters(-4.5))).toBe('11 00 00 3e fe 28 33')
  })

  it('carries wind, rolling and drag coefficients', () => {
    const frame = buildSimulationParameters(0, { windSpeedMs: 2, crr: 0.005, cw: 0.4 })
    // 2 m/s => 2000 => 0x07D0 little-endian; 0.005 => 50; 0.4 => 40
    expect(hex(frame)).toBe('11 d0 07 00 00 32 28')
  })

  // Wrapping would turn an absurd climb into a descent, which is the one
  // failure mode a rider would feel as the trainer suddenly letting go.
  it('clamps rather than wraps', () => {
    expect(hex(buildSimulationParameters(1000))).toBe('11 00 00 ff 7f 28 33')
    expect(hex(buildSimulationParameters(-1000))).toBe('11 00 00 00 80 28 33')
    expect(hex(buildSimulationParameters(0, { crr: 1, cw: 10 }))).toBe('11 00 00 00 00 ff ff')
    expect(hex(buildSimulationParameters(0, { crr: -1 }))).toBe('11 00 00 00 00 00 33')
  })

  it('sends a flat road rather than nonsense for a bad gradient', () => {
    expect(hex(buildSimulationParameters(Number.NaN))).toBe('11 00 00 00 00 28 33')
  })
})

describe('other control point frames', () => {
  it('builds the ones a ride needs', () => {
    expect(hex(buildRequestControl())).toBe('00')
    expect(hex(buildStart())).toBe('07')
    expect(hex(buildStop())).toBe('08 01')
  })
})

describe('parseIndoorBikeData', () => {
  it('reads speed, cadence and power', () => {
    // flags 0x0044: bit0 clear (speed present), bit2 cadence, bit6 power
    const data = parseIndoorBikeData(view(0x44, 0x00, 0xb2, 0x0c, 0xaa, 0x00, 0xfa, 0x00))
    expect(data.speedKmh).toBeCloseTo(32.5, 6)
    expect(data.cadenceRpm).toBe(85)
    expect(data.powerW).toBe(250)
  })

  // Bit 0 is "More Data" and means the opposite of every other flag. Reading
  // it the obvious way shifts every later field by two bytes, which shows up
  // as plausible-looking but completely wrong power.
  it('treats bit 0 as inverted', () => {
    const withSpeed = parseIndoorBikeData(view(0x44, 0x00, 0xb2, 0x0c, 0xaa, 0x00, 0xfa, 0x00))
    const withoutSpeed = parseIndoorBikeData(view(0x45, 0x00, 0xaa, 0x00, 0xfa, 0x00))

    expect(withSpeed.speedKmh).toBeDefined()
    expect(withoutSpeed.speedKmh).toBeUndefined()
    expect(withoutSpeed.cadenceRpm).toBe(85)
    expect(withoutSpeed.powerW).toBe(250)
  })

  it('reads half-rpm cadence resolution', () => {
    // flags 0x0005: bit0 set so no speed, bit2 cadence. 0x00AB = 171 half-rpm.
    const data = parseIndoorBikeData(view(0x05, 0x00, 0xab, 0x00))
    expect(data.cadenceRpm).toBe(85.5)
  })

  it('reads power as signed', () => {
    const data = parseIndoorBikeData(view(0x41, 0x00, 0xce, 0xff))
    expect(data.powerW).toBe(-50)
  })

  it('reads a 24-bit total distance', () => {
    // flags 0x0011: bit0 set (no speed), bit4 distance. 0x0186A0 = 100000
    const data = parseIndoorBikeData(view(0x11, 0x00, 0xa0, 0x86, 0x01))
    expect(data.totalDistanceM).toBe(100_000)
  })

  it('walks past fields it does not need to reach the ones it does', () => {
    // Every field up to power: speed, avg speed, cadence, avg cadence,
    // distance, resistance, power.
    const data = parseIndoorBikeData(
      view(
        0x7e, 0x00, // flags: bits 1-6 set, bit0 clear
        0xb2, 0x0c, // speed 32.50
        0x88, 0x0b, // average speed 29.52
        0xaa, 0x00, // cadence 85
        0xa0, 0x00, // average cadence 80
        0xe8, 0x03, 0x00, // distance 1000
        0x0a, 0x00, // resistance 10
        0xfa, 0x00, // power 250
      ),
    )
    expect(data.speedKmh).toBeCloseTo(32.5, 6)
    expect(data.averageSpeedKmh).toBeCloseTo(29.52, 6)
    expect(data.cadenceRpm).toBe(85)
    expect(data.averageCadenceRpm).toBe(80)
    expect(data.totalDistanceM).toBe(1000)
    expect(data.resistanceLevel).toBe(10)
    expect(data.powerW).toBe(250)
  })

  it('steps over the three-part energy field to reach heart rate', () => {
    // flags 0x0300: bit8 energy, bit9 heart rate, bit0 set so no speed.
    const data = parseIndoorBikeData(
      view(0x01, 0x03, 0x2c, 0x01, 0x90, 0x01, 0x08, 0x8c),
    )
    expect(data.totalEnergyKcal).toBe(300)
    expect(data.heartRateBpm).toBe(140)
  })

  // A dropped tail should cost one reading, not the ride.
  it('survives a truncated frame', () => {
    const data = parseIndoorBikeData(view(0x44, 0x00, 0xb2, 0x0c))
    expect(data.speedKmh).toBeCloseTo(32.5, 6)
    expect(data.cadenceRpm).toBeUndefined()
    expect(data.powerW).toBeUndefined()
  })

  it('survives an empty frame', () => {
    expect(parseIndoorBikeData(view())).toEqual({})
    expect(parseIndoorBikeData(view(0x44))).toEqual({})
  })
})

describe('parseControlResponse', () => {
  it('accepts a success', () => {
    const response = parseControlResponse(view(0x80, 0x11, 0x01))
    expect(response).toMatchObject({ requestOpcode: 0x11, ok: true, reason: 'success' })
  })

  it('explains a refusal', () => {
    const response = parseControlResponse(view(0x80, 0x11, 0x05))
    expect(response?.ok).toBe(false)
    expect(response?.reason).toBe('control not permitted')
  })

  it('names a result it does not recognise', () => {
    expect(parseControlResponse(view(0x80, 0x11, 0x42))?.reason).toContain('0x42')
  })

  it('ignores anything that is not a response', () => {
    expect(parseControlResponse(view(0x11, 0x01, 0x01))).toBeNull()
    expect(parseControlResponse(view(0x80, 0x11))).toBeNull()
  })
})

describe('parseFeatures', () => {
  it('finds simulation support in bit 13 of the target features', () => {
    const features = parseFeatures(view(0, 0, 0, 0, 0x00, 0x20, 0x00, 0x00))
    expect(features?.simulation).toBe(true)
    expect(features?.power).toBe(false)
  })

  it('reports a trainer that cannot simulate a gradient', () => {
    const features = parseFeatures(view(0, 0, 0, 0, 0x08, 0x00, 0x00, 0x00))
    expect(features?.simulation).toBe(false)
    expect(features?.power).toBe(true)
  })

  it('ignores a short frame', () => {
    expect(parseFeatures(view(0, 0, 0, 0))).toBeNull()
  })
})
