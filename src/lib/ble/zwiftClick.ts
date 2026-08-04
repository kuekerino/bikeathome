/**
 * A Zwift Click over Web Bluetooth.
 *
 * Two generations exist. The original exposes its characteristics under a
 * 128-bit service; newer firmware moved the same three under a 16-bit one.
 * Both are tried, in that order, because only the original is firmly
 * documented — the keyboard stays connected either way, so a Click that
 * misbehaves costs convenience rather than the ride.
 */

import { BATTERY_SERVICE, clickRequest } from './discovery'
import { during, writeValue } from './gatt'
import type { ConnectionState, Shifter } from './types'
import {
  ClickShiftDetector,
  parseClickMessage,
  readHandshake,
  RIDE_ON,
  ZWIFT_ASYNC,
  ZWIFT_SERVICE_V1,
  ZWIFT_SERVICE_V2,
  ZWIFT_SYNC_RX,
  ZWIFT_SYNC_TX,
} from './zwiftClickProtocol'

const BATTERY_LEVEL = 0x2a19

/** A Click that drops mid-ride should come back without the rider stopping. */
const RECONNECT_ATTEMPTS = 6
const RECONNECT_BASE_MS = 1000
const RECONNECT_CAP_MS = 20_000

export class ZwiftClick implements Shifter {
  onshift: ((direction: 1 | -1) => void) | null = null
  onbattery: ((percent: number) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  private device: BluetoothDevice | null = null
  private connection: ConnectionState = 'disconnected'
  private name = 'Zwift Click'
  private readonly shifts = new ClickShiftDetector()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private closing = false
  private swapButtons = false

  /** Which physical button shifts up is the rider's call, not ours. */
  configure({ swapButtons }: { swapButtons: boolean }): void {
    this.swapButtons = swapButtons
  }

  get label(): string {
    return this.name
  }

  get state(): ConnectionState {
    return this.connection
  }

  /** @param showEverything lists every Bluetooth device rather than only Clicks. */
  async connect(showEverything = false): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge.')
    }

    this.closing = false
    this.setState('connecting')
    try {
      this.device = await navigator.bluetooth.requestDevice(clickRequest(showEverything))
      this.name = this.device.name ?? 'Zwift Click'
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
    this.shifts.reset()
    this.setState('disconnected')
  }

  private async openSession(): Promise<void> {
    const server = await this.device?.gatt?.connect()
    if (!server) throw new Error('Could not reach the Click over GATT.')

    const service = await during('Finding the Click service', () => findZwiftService(server))
    // Whatever the buttons were doing before the drop is no longer true.
    this.shifts.reset()
    await during('Subscribing to the Click buttons', () => this.listen(service))
    await during('Sending the RideOn handshake', () => this.shakeHands(service))
    await this.readBattery(server)
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer !== null) return

    if (this.reconnectAttempts >= RECONNECT_ATTEMPTS) {
      this.setState('error', `Lost ${this.name}. Shift with the keyboard, or pair again.`)
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

  private async listen(service: BluetoothRemoteGATTService): Promise<void> {
    const async_ = await service.getCharacteristic(ZWIFT_ASYNC)
    async_.addEventListener('characteristicvaluechanged', (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value
      if (value) this.handle(new Uint8Array(value.buffer))
    })
    await async_.startNotifications()
  }

  private async shakeHands(service: BluetoothRemoteGATTService): Promise<void> {
    const syncTx = await service.getCharacteristic(ZWIFT_SYNC_TX)
    syncTx.addEventListener('characteristicvaluechanged', (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value
      if (!value) return

      const result = readHandshake(new Uint8Array(value.buffer))
      if (result === 'encrypted') {
        // We never ask for encryption, so this means the exchange went wrong.
        this.setState('error', 'The Click answered in encrypted mode.')
      } else if (result === 'unrecognised') {
        this.setState('error', 'The Click did not answer the handshake.')
      }
    })

    // Subscribe before writing, or the reply is gone before anyone is looking.
    await syncTx.startNotifications()

    const syncRx = await service.getCharacteristic(ZWIFT_SYNC_RX)
    await writeValue(syncRx, RIDE_ON as BufferSource)
  }

  private async readBattery(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService(BATTERY_SERVICE)
      const level = await (await service.getCharacteristic(BATTERY_LEVEL)).readValue()
      this.onbattery?.(level.getUint8(0))
    } catch {
      // Optional. The device also reports battery in its own messages.
    }
  }

  private handle(bytes: Uint8Array): void {
    const message = parseClickMessage(bytes)

    if (message.kind === 'battery') {
      this.onbattery?.(message.percent)
      return
    }
    if (message.kind === 'disconnect') {
      this.setState('disconnected', 'The Click said goodbye.')
      return
    }

    for (const direction of this.shifts.update(message)) {
      this.onshift?.(this.swapButtons ? ((-direction | 0) as 1 | -1) : direction)
    }
  }

  private readonly onDropped = (): void => {
    this.shifts.reset()
    this.setState('disconnected', 'The Click dropped its connection.')
    this.scheduleReconnect()
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.connection = state
    this.onstate?.(state, detail)
  }
}

async function findZwiftService(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTService> {
  for (const uuid of [ZWIFT_SERVICE_V1, ZWIFT_SERVICE_V2] as const) {
    try {
      return await server.getPrimaryService(uuid)
    } catch {
      // Try the other generation.
    }
  }
  throw new Error('That device does not look like a Zwift Click.')
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotFoundError') return 'No Click chosen.'
    return error.message
  }
  return String(error)
}
