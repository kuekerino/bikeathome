/**
 * A real trainer over Web Bluetooth, speaking FTMS.
 *
 * Chrome or Edge only, over HTTPS or localhost, and `connect` has to be called
 * from a user gesture or the browser will refuse to show the chooser.
 */

import { AIR_DENSITY, DEFAULT_RIDER, type RiderSettings } from '../physics/constants'
import { trainerRequest } from './discovery'
import {
  buildRequestControl,
  buildSimulationParameters,
  buildStart,
  buildStop,
  buildTargetPower,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FTMS_SERVICE,
  INDOOR_BIKE_DATA,
  parseControlResponse,
  parseFeatures,
  parseIndoorBikeData,
} from './ftms'
import type { ConnectionState, Trainer, TrainerData } from './types'

/**
 * How often the pending gradient is pushed to the trainer. The engine calls
 * `setSimulation` on every tick; this decides what actually goes over the air,
 * so the link rate is the device's business and not the caller's.
 */
const FLUSH_MS = 250

/** Below this the trainer would not feel the difference anyway. */
const GRADIENT_EPSILON = 0.05

/** Resend even when nothing changed, so the trainer knows we are still here. */
const HEARTBEAT_MS = 5000

/**
 * Reconnect attempts after a drop. Web Bluetooth remembers a device the rider
 * already chose, so getting back on does not need another gesture — which
 * matters when the interruption happens mid-climb.
 */
const RECONNECT_ATTEMPTS = 6
const RECONNECT_BASE_MS = 1000
const RECONNECT_CAP_MS = 20_000

export class FtmsTrainer implements Trainer {
  ondata: ((data: TrainerData) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  private device: BluetoothDevice | null = null
  private controlPoint: BluetoothRemoteGATTCharacteristic | null = null
  private connection: ConnectionState = 'disconnected'
  private name = 'Trainer'
  private rider: RiderSettings = DEFAULT_RIDER

  private desiredGradient = 0
  private sentGradient: number | null = null
  /** Watts to hold in ERG, or `null` to simulate the gradient instead. */
  private desiredPower: number | null = null
  private sentPower: number | null = null
  private lastSentAt = 0
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  /** Set while disconnecting on purpose, so we do not fight the rider. */
  private closing = false

  /** Serialises control point writes: overlapping GATT operations are rejected. */
  private queue: Promise<unknown> = Promise.resolve()

  get label(): string {
    return this.name
  }

  get state(): ConnectionState {
    return this.connection
  }

  configure(rider: RiderSettings): void {
    this.rider = rider
  }

  /**
   * @param showEverything lists every Bluetooth device rather than the ones
   * advertising a trainer service. For trainers whose advertisement gives
   * nothing away.
   */
  async connect(showEverything = false): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge.')
    }

    await this.adopt(() => navigator.bluetooth.requestDevice(trainerRequest(showEverything)))
  }

  /**
   * Reconnects to a device this browser already has permission for, without a
   * chooser and without a user gesture. Only `requestDevice` needs the gesture;
   * connecting to an already-permitted device does not.
   */
  async resume(device: BluetoothDevice): Promise<void> {
    await this.adopt(() => Promise.resolve(device))
  }

  private async adopt(find: () => Promise<BluetoothDevice>): Promise<void> {
    this.closing = false
    this.setState('connecting')
    try {
      this.device = await find()
      this.name = this.device.name ?? 'Trainer'
      this.device.addEventListener('gattserverdisconnected', this.onDropped)

      await this.openSession()

      this.reconnectAttempts = 0
      this.setState('connected')
      this.flushTimer ??= setInterval(() => void this.flush(), FLUSH_MS)
    } catch (error) {
      this.setState('error', describe(error))
      throw error
    }
  }

  get deviceId(): string | undefined {
    return this.device?.id
  }

  async disconnect(): Promise<void> {
    this.closing = true

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Best effort: hand control back before dropping the link.
    if (this.controlPoint) await this.write(buildStop()).catch(() => undefined)

    this.device?.removeEventListener('gattserverdisconnected', this.onDropped)
    this.device?.gatt?.disconnect()
    this.device = null
    this.controlPoint = null
    this.sentGradient = null
    this.sentPower = null
    this.setState('disconnected')
  }

  /** Records the wanted gradient. The flush timer decides when it goes out. */
  async setSimulation(gradientPct: number): Promise<void> {
    this.desiredGradient = gradientPct
  }

  /**
   * Switches between holding a power and simulating the gradient. Leaving ERG
   * clears the sent gradient so the next flush resends it — the trainer has
   * been in power mode and no longer knows what slope it was on.
   */
  async setTargetPower(watts: number | null): Promise<void> {
    if (watts === this.desiredPower) return
    this.desiredPower = watts
    if (watts === null) this.sentGradient = null
    else this.sentPower = null
  }

  /** Everything needed to go from a connected GATT server to a usable trainer. */
  private async openSession(): Promise<void> {
    const server = await this.device?.gatt?.connect()
    if (!server) throw new Error('Could not reach the trainer over GATT.')

    const service = await server.getPrimaryService(FTMS_SERVICE)
    await this.checkFeatures(service)
    await this.subscribeToData(service)
    await this.takeControl(service)
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer !== null) return

    if (this.reconnectAttempts >= RECONNECT_ATTEMPTS) {
      this.setState('error', `Lost ${this.name} and could not get it back.`)
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
      // Force the next flush to resend: the trainer forgot where it was.
      this.sentGradient = null
      this.sentPower = null
      this.setState('connected')
    } catch {
      this.scheduleReconnect()
    }
  }

  private async checkFeatures(service: BluetoothRemoteGATTService): Promise<void> {
    try {
      const characteristic = await service.getCharacteristic(FITNESS_MACHINE_FEATURE)
      const features = parseFeatures(await characteristic.readValue())
      if (features && !features.simulation) {
        // Not fatal — say so and carry on, since the reading still works.
        this.setState('connecting', `${this.name} does not advertise gradient simulation.`)
      }
    } catch {
      // Optional characteristic. Plenty of trainers simulate without it.
    }
  }

  private async subscribeToData(service: BluetoothRemoteGATTService): Promise<void> {
    const characteristic = await service.getCharacteristic(INDOOR_BIKE_DATA)
    characteristic.addEventListener('characteristicvaluechanged', (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value
      if (!value) return

      const { powerW, cadenceRpm, speedKmh } = parseIndoorBikeData(value)
      this.ondata?.({ powerW, cadenceRpm, speedKmh })
    })
    await characteristic.startNotifications()
  }

  private async takeControl(service: BluetoothRemoteGATTService): Promise<void> {
    const controlPoint = await service.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT)

    controlPoint.addEventListener('characteristicvaluechanged', (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value
      const response = value ? parseControlResponse(value) : null
      if (response && !response.ok) {
        this.setState('error', `Trainer refused a command: ${response.reason}`)
      }
    })

    // Subscribe before writing, or the answer to the first command is missed.
    await controlPoint.startNotifications()
    this.controlPoint = controlPoint

    await this.write(buildRequestControl())
    await this.write(buildStart())
  }

  private async flush(): Promise<void> {
    if (!this.controlPoint) return
    const now = Date.now()

    const power = this.desiredPower
    if (power !== null) {
      if (power === this.sentPower && now - this.lastSentAt < HEARTBEAT_MS) return
      try {
        await this.write(buildTargetPower(power))
        this.sentPower = power
        this.lastSentAt = now
      } catch (error) {
        this.setState('error', describe(error))
      }
      return
    }

    const changed =
      this.sentGradient === null ||
      Math.abs(this.desiredGradient - this.sentGradient) >= GRADIENT_EPSILON
    if (!changed && now - this.lastSentAt < HEARTBEAT_MS) return

    const gradient = this.desiredGradient
    try {
      await this.write(
        buildSimulationParameters(gradient, {
          crr: this.rider.crr,
          // FTMS wants a wind resistance coefficient in kg/m, which is the
          // drag area scaled by air density.
          cw: AIR_DENSITY * this.rider.cda,
        }),
      )
      this.sentGradient = gradient
      this.lastSentAt = now
    } catch (error) {
      this.setState('error', describe(error))
    }
  }

  private write(frame: Uint8Array): Promise<void> {
    const attempt = this.queue.then(async () => {
      const characteristic = this.controlPoint
      if (!characteristic) throw new Error('Not connected to a trainer.')
      await characteristic.writeValueWithResponse(frame as BufferSource)
    })

    // Keep the chain alive after a failure, or one error stops every later write.
    this.queue = attempt.catch(() => undefined)
    return attempt
  }

  private readonly onDropped = (): void => {
    this.controlPoint = null
    this.sentGradient = null
    this.setState('disconnected', 'The trainer dropped its connection.')
    this.scheduleReconnect()
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.connection = state
    this.onstate?.(state, detail)
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // The chooser being dismissed is a normal outcome, not a fault.
    if (error.name === 'NotFoundError') return 'No trainer chosen.'
    return error.message
  }
  return String(error)
}
