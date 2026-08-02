/**
 * A Zwift Click over Web Bluetooth.
 *
 * Two generations exist. The original exposes its characteristics under a
 * 128-bit service; newer firmware moved the same three under a 16-bit one.
 * Both are tried, in that order, because only the original is firmly
 * documented — the keyboard stays connected either way, so a Click that
 * misbehaves costs convenience rather than the ride.
 */

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

const BATTERY_SERVICE = 0x180f
const BATTERY_LEVEL = 0x2a19
const DEVICE_INFORMATION = 0x180a

export class ZwiftClick implements Shifter {
  onshift: ((direction: 1 | -1) => void) | null = null
  onbattery: ((percent: number) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  private device: BluetoothDevice | null = null
  private connection: ConnectionState = 'disconnected'
  private name = 'Zwift Click'
  private readonly shifts = new ClickShiftDetector()

  get label(): string {
    return this.name
  }

  get state(): ConnectionState {
    return this.connection
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge.')
    }

    this.setState('connecting')
    try {
      this.device = await navigator.bluetooth.requestDevice({
        // Either a Zwift-branded name or the service itself, since which of
        // the two a given unit advertises is not consistent.
        filters: [{ namePrefix: 'Zwift' }, { services: [ZWIFT_SERVICE_V1] }],
        optionalServices: [
          ZWIFT_SERVICE_V1,
          ZWIFT_SERVICE_V2,
          BATTERY_SERVICE,
          DEVICE_INFORMATION,
        ],
      })
      this.name = this.device.name ?? 'Zwift Click'
      this.device.addEventListener('gattserverdisconnected', this.onDropped)

      const server = await this.device.gatt?.connect()
      if (!server) throw new Error('Could not reach the Click over GATT.')

      const service = await findZwiftService(server)
      this.shifts.reset()
      await this.listen(service)
      await this.shakeHands(service)
      await this.readBattery(server)

      this.setState('connected')
    } catch (error) {
      this.setState('error', describe(error))
      throw error
    }
  }

  async disconnect(): Promise<void> {
    this.device?.removeEventListener('gattserverdisconnected', this.onDropped)
    this.device?.gatt?.disconnect()
    this.device = null
    this.shifts.reset()
    this.setState('disconnected')
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
    await syncRx.writeValueWithResponse(RIDE_ON as BufferSource)
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

    for (const direction of this.shifts.update(message)) this.onshift?.(direction)
  }

  private readonly onDropped = (): void => {
    this.shifts.reset()
    this.setState('disconnected', 'The Click dropped its connection.')
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
