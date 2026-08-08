/**
 * A heart rate strap over Web Bluetooth.
 *
 * Unlike the Click, none of this is reverse-engineered: Heart Rate Service is
 * a Bluetooth SIG standard that every strap implements the same way, so the
 * whole device is a parser and a notification.
 */

import { BATTERY_SERVICE, HEART_RATE_SERVICE, heartRateRequest } from './discovery'
import { during } from './gatt'
import type { ConnectionState, Device } from './types'

export const HEART_RATE_MEASUREMENT = 0x2a37

const BATTERY_LEVEL = 0x2a19

/** A strap that drops mid-ride should come back without the rider stopping. */
const RECONNECT_ATTEMPTS = 6
const RECONNECT_BASE_MS = 1000
const RECONNECT_CAP_MS = 20_000

export interface HeartRateReading {
  bpm: number
  /**
   * Whether the strap says it is actually against skin. `undefined` when it
   * does not report contact at all, which is not the same as "no contact" —
   * plenty of straps simply never say.
   */
  contact?: boolean
}

/**
 * Heart Rate Measurement (0x2A37). A flags byte, then the rate as either one
 * byte or two, then optional fields nobody here needs.
 *
 * Bit 0 decides the width of the value that follows it, so reading it as the
 * wrong size is not a rounding error — above 255 bpm it wraps, and below it
 * silently reads the wrong byte.
 */
export function parseHeartRate(view: DataView): HeartRateReading | null {
  if (view.byteLength < 2) return null

  const flags = view.getUint8(0)
  const wide = (flags & 0x01) !== 0
  if (wide && view.byteLength < 3) return null

  const bpm = wide ? view.getUint16(1, true) : view.getUint8(1)
  // A strap reporting zero is not a heart that stopped; it is a strap that has
  // not found a beat yet.
  if (bpm <= 0 || bpm > 300) return null

  // Bits 1-2: 0 and 1 both mean "contact not supported".
  const contactBits = (flags >> 1) & 0x03
  const contact = contactBits < 2 ? undefined : contactBits === 3

  return contact === undefined ? { bpm } : { bpm, contact }
}

export class HeartRateMonitor implements Device {
  onreading: ((reading: HeartRateReading) => void) | null = null
  onbattery: ((percent: number) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  private device: BluetoothDevice | null = null
  private connection: ConnectionState = 'disconnected'
  private name = 'Heart rate'
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private closing = false

  get label(): string {
    return this.name
  }

  get state(): ConnectionState {
    return this.connection
  }

  get deviceId(): string | undefined {
    return this.device?.id
  }

  /** @param showEverything lists every Bluetooth device rather than only straps. */
  async connect(showEverything = false): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge.')
    }
    await this.adopt(() => navigator.bluetooth.requestDevice(heartRateRequest(showEverything)))
  }

  /** Reconnects to an already-permitted device, with no chooser and no gesture. */
  async resume(device: BluetoothDevice): Promise<void> {
    await this.adopt(() => Promise.resolve(device))
  }

  private async adopt(find: () => Promise<BluetoothDevice>): Promise<void> {
    this.closing = false
    this.setState('connecting')
    try {
      this.device = await find()
      this.name = this.device.name ?? 'Heart rate'
      this.device.addEventListener('gattserverdisconnected', this.onDropped)
      await this.openSession()
      this.reconnectAttempts = 0
      this.setState('connected')
    } catch (error) {
      this.setState('error', describe(error))
      throw error
    }
  }

  async disconnect(): Promise<void> {
    this.closing = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.device?.removeEventListener('gattserverdisconnected', this.onDropped)
    this.device?.gatt?.disconnect()
    this.device = null
    this.setState('disconnected')
  }

  private async openSession(): Promise<void> {
    const server = await this.device?.gatt?.connect()
    if (!server) throw new Error('Could not reach the strap over GATT.')

    await during('Subscribing to the heart rate', async () => {
      const service = await server.getPrimaryService(HEART_RATE_SERVICE)
      const characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT)
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value
        if (!value) return
        const reading = parseHeartRate(value)
        if (reading) this.onreading?.(reading)
      })
      await characteristic.startNotifications()
    })

    await this.readBattery(server)
  }

  private async readBattery(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService(BATTERY_SERVICE)
      const level = await (await service.getCharacteristic(BATTERY_LEVEL)).readValue()
      this.onbattery?.(level.getUint8(0))
    } catch {
      // Optional, and not worth failing a connection over.
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer !== null) return

    if (this.reconnectAttempts >= RECONNECT_ATTEMPTS) {
      this.setState('error', `Lost ${this.name}. Pair again to get it back.`)
      return
    }

    const delay = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.reconnect()
    }, delay)
  }

  private async reconnect(): Promise<void> {
    if (this.closing) return
    this.setState('connecting', `Reconnecting to ${this.name}…`)
    try {
      await this.openSession()
      this.reconnectAttempts = 0
      this.setState('connected')
    } catch {
      this.scheduleReconnect()
    }
  }

  private readonly onDropped = (): void => {
    this.setState('disconnected', 'The strap dropped its connection.')
    this.scheduleReconnect()
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.connection = state
    this.onstate?.(state, detail)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
