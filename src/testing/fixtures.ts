/**
 * Shared test doubles. Not imported by app code, so it never reaches a bundle.
 */

import type { ConnectionState, Shifter, Trainer, TrainerData } from '../lib/ble/types'
import { Route, EARTH_RADIUS_M } from '../lib/gpx/route'

const METRES_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_M) / 180

/**
 * A route running due north with points at a fixed spacing. Along a meridian
 * the great-circle distance is exactly R * deltaLat, so the distances are
 * known rather than approximated.
 */
export function straightRoute(
  spacingM: number,
  elevations: number[],
  name: string | null = 'Test route',
): Route {
  const step = spacingM / METRES_PER_DEGREE_LAT
  return Route.from({
    name,
    hasElevation: true,
    points: elevations.map((ele, i) => ({ lat: 47 + i * step, lon: 11, ele })),
  })
}

/** A flat route of a given length, with points every 100 m. */
export function flatRoute(lengthM: number): Route {
  const count = Math.round(lengthM / 100) + 1
  return straightRoute(100, new Array(count).fill(0))
}

/** A constant climb of a given length and gradient, with points every 100 m. */
export function climbRoute(lengthM: number, gradientPct: number): Route {
  const count = Math.round(lengthM / 100) + 1
  return straightRoute(
    100,
    Array.from({ length: count }, (_, i) => i * 100 * (gradientPct / 100)),
  )
}

export class FakeTrainer implements Trainer {
  readonly label = 'Fake trainer'
  state: ConnectionState = 'connected'
  ondata: ((data: TrainerData) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  /** Every gradient the engine has asked for, in order. */
  readonly gradients: number[] = []
  /** Every ERG target, in order. `null` means "back to the gradient". */
  readonly powerTargets: (number | null)[] = []

  async connect(): Promise<void> {
    this.state = 'connected'
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected'
  }

  async setSimulation(gradientPct: number): Promise<void> {
    this.gradients.push(gradientPct)
  }

  async setTargetPower(watts: number | null): Promise<void> {
    this.powerTargets.push(watts)
  }

  get lastPowerTarget(): number | null | undefined {
    return this.powerTargets[this.powerTargets.length - 1]
  }

  /** Pretend the trainer pushed a data notification. */
  send(data: TrainerData): void {
    this.ondata?.(data)
  }

  get lastGradient(): number | undefined {
    return this.gradients[this.gradients.length - 1]
  }
}

export class FakeShifter implements Shifter {
  readonly label = 'Fake shifter'
  state: ConnectionState = 'connected'
  onbutton: ((id: string) => void) | null = null
  onbattery: ((percent: number) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  async connect(): Promise<void> {
    this.state = 'connected'
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected'
  }

  /** Press a button by id, as the real device reports it. */
  press(id: string): void {
    this.onbutton?.(id)
  }
}
