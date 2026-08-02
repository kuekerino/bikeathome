/**
 * A trainer that isn't there.
 *
 * Models the thing that actually matters about a single-cog setup: the cog is
 * fixed, so cadence maps straight to flywheel speed, and the resistance the
 * trainer applies decides how much power that cadence is worth. Pick the wrong
 * virtual gear and you either grind or spin out, exactly as you would on the
 * road — which is what makes this useful for exercising the shifting logic
 * rather than just filling the dashboard with numbers.
 */

import { DEFAULT_RIDER, type RiderSettings } from '../physics/constants'
import { forcesAt } from '../physics/forces'
import { DEFAULT_DRIVETRAIN, type DrivetrainSettings } from '../physics/gears'
import type { ConnectionState, Trainer, TrainerData } from './types'

/** Virtual wheel circumference trainers use internally, in metres (700x25). */
export const WHEEL_CIRCUMFERENCE_M = 2.096

export interface SimulationOptions {
  rider: RiderSettings
  drivetrain: DrivetrainSettings
  /** The effort the simulated rider is trying to hold, in watts. */
  targetPowerW: number
  /** Below this the rider is grinding and cannot hold the target. */
  minCadenceRpm: number
  /** Above this the rider is spinning out. */
  maxCadenceRpm: number
}

export const DEFAULT_SIMULATION: SimulationOptions = {
  rider: DEFAULT_RIDER,
  drivetrain: DEFAULT_DRIVETRAIN,
  targetPowerW: 180,
  minCadenceRpm: 50,
  maxCadenceRpm: 110,
}

/**
 * What the rider produces against a given trainer resistance. Deterministic —
 * the jitter that makes it look alive lives in the class below.
 */
export function simulateRider(
  gradientPct: number,
  options: SimulationOptions,
): Required<TrainerData> {
  const ratio = options.drivetrain.chainringTeeth / options.drivetrain.cogTeeth
  const speedAt = (cadence: number) => (cadence / 60) * ratio * WHEEL_CIRCUMFERENCE_M
  const powerAt = (cadence: number) => {
    const speed = speedAt(cadence)
    return forcesAt(gradientPct, speed, options.rider).total * speed
  }

  const cadence = solveCadence(powerAt, options, gradientPct)
  const speed = speedAt(cadence)

  return {
    // A trainer cannot report negative watts, however hard gravity is pulling.
    powerW: Math.max(0, powerAt(cadence)),
    cadenceRpm: cadence,
    speedKmh: speed * 3.6,
  }
}

/**
 * The cadence at which the rider hits their target power, held between the
 * limits of what a human will actually turn. Pinning at a limit is the
 * interesting case: it is what being in the wrong gear feels like.
 */
function solveCadence(
  powerAt: (cadence: number) => number,
  options: SimulationOptions,
  gradientPct: number,
): number {
  const { minCadenceRpm: low, maxCadenceRpm: high, targetPowerW: target } = options

  // Freewheeling: no resistance worth pushing against at any cadence.
  if (powerAt(high) <= 0) return gradientPct < 0 ? high : low
  // Too big a gear to spin up: grinding at the bottom of the range.
  if (powerAt(low) >= target) return low
  // Too small a gear to load up: spinning out at the top.
  if (powerAt(high) <= target) return high

  // Power rises with cadence between those bounds, so bisection converges.
  let lo = low
  let hi = high
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (powerAt(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** How often a real trainer pushes Indoor Bike Data, roughly. */
const NOTIFY_INTERVAL_MS = 500

export class SimulatedTrainer implements Trainer {
  readonly label = 'Simulated trainer'

  ondata: ((data: TrainerData) => void) | null = null
  onstate: ((state: ConnectionState, detail?: string) => void) | null = null

  private connection: ConnectionState = 'disconnected'
  private timer: ReturnType<typeof setInterval> | null = null
  private gradientPct = 0

  constructor(private options: SimulationOptions = DEFAULT_SIMULATION) {}

  get state(): ConnectionState {
    return this.connection
  }

  /** Lets the settings panel retune the demo rider mid-ride. */
  configure(options: Partial<SimulationOptions>): void {
    this.options = { ...this.options, ...options }
  }

  async connect(): Promise<void> {
    this.setState('connected')
    this.timer ??= setInterval(() => this.emit(), NOTIFY_INTERVAL_MS)
  }

  async disconnect(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.setState('disconnected')
  }

  async setSimulation(gradientPct: number): Promise<void> {
    this.gradientPct = gradientPct
  }

  private emit(): void {
    const { powerW, cadenceRpm, speedKmh } = simulateRider(this.gradientPct, this.options)
    // Real trainers wobble; a perfectly flat number reads as broken.
    this.ondata?.({
      powerW: Math.max(0, Math.round(jitter(powerW, 0.04))),
      cadenceRpm: Math.round(jitter(cadenceRpm, 0.02)),
      speedKmh,
    })
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.connection = state
    this.onstate?.(state, detail)
  }
}

function jitter(value: number, amount: number): number {
  return value * (1 + (Math.random() * 2 - 1) * amount)
}
