/**
 * The ride loop: turns trainer data and a route into a moving rider, and turns
 * the rider's position and gear back into a resistance for the trainer.
 *
 * Timing is pushed in from outside via `tick(now)` rather than owned here, so
 * the whole thing can be driven deterministically in tests and wired to a real
 * timer in the app.
 *
 * `subscribe` follows the Svelte store contract, so components can read the
 * engine directly with `$engine`.
 */

import type { Route } from '../gpx/route'
import { DEFAULT_RIDER, type RiderSettings } from '../physics/constants'
import { adjustedGradient } from '../physics/forces'
import {
  clampGear,
  DEFAULT_DRIVETRAIN,
  DEFAULT_GEAR,
  gearRatio,
  relativeRatio,
  shiftGear,
  type DrivetrainSettings,
} from '../physics/gears'
import { MOTION_AT_REST, stepMotion, type MotionState } from '../physics/motion'
import type { Shifter, Trainer, TrainerData } from '../ble/types'

export type RideStatus = 'idle' | 'ready' | 'riding' | 'paused' | 'finished'

/** Below this, with no power, the rider counts as stopped. */
const STOPPED_SPEED_MS = 0.5

export interface RideSnapshot {
  status: RideStatus
  routeName: string | null
  /** Metres along the route. */
  distance: number
  routeDistance: number
  speedMs: number
  powerW: number
  cadenceRpm: number
  gear: number
  gearRatio: number
  relativeRatio: number
  /** The route's own gradient at the rider's position, in percent. */
  routeGradient: number
  /** What the trainer is being asked to simulate, in percent. */
  trainerGradient: number
  elapsedSeconds: number
  elevation: number
  climbed: number
  routeAscent: number
  lat: number
  lon: number
}

export interface RideEngineOptions {
  rider?: RiderSettings
  drivetrain?: DrivetrainSettings
  /** Seconds of not pedalling before the clock stops. Zero disables it. */
  autoPauseSeconds?: number
}

export class RideEngine {
  rider: RiderSettings
  drivetrain: DrivetrainSettings
  autoPauseSeconds: number

  /** Reports a failed write to the trainer; the device reports link state itself. */
  onerror: ((error: unknown) => void) | null = null

  private route: Route | null = null
  private status: RideStatus = 'idle'
  private motion: MotionState = MOTION_AT_REST
  private gear = DEFAULT_GEAR
  private latest: TrainerData = {}
  private trainerGradient = 0
  private elapsedMs = 0
  private climbed = 0
  private lastElevation: number | null = null
  private lastTickMs: number | null = null
  private idleMs = 0
  /**
   * Whether the current pause was the app's doing. Pausing by hand has to
   * stick even while the rider keeps spinning; only an auto-pause should lift
   * itself when the pedals start turning again.
   */
  private autoPaused = false

  private trainer: Trainer | null = null
  private shifter: Shifter | null = null
  private readonly listeners = new Set<(snapshot: RideSnapshot) => void>()

  constructor(options: RideEngineOptions = {}) {
    this.rider = options.rider ?? DEFAULT_RIDER
    this.drivetrain = options.drivetrain ?? DEFAULT_DRIVETRAIN
    this.autoPauseSeconds = options.autoPauseSeconds ?? 5
  }

  // --- wiring -------------------------------------------------------------

  attachTrainer(trainer: Trainer | null): void {
    if (this.trainer) this.trainer.ondata = null
    this.trainer = trainer
    if (trainer) trainer.ondata = (data) => this.onTrainerData(data)
    this.notify()
  }

  attachShifter(shifter: Shifter | null): void {
    if (this.shifter) this.shifter.onshift = null
    this.shifter = shifter
    if (shifter) shifter.onshift = (direction) => this.shift(direction)
    this.notify()
  }

  configure(settings: { rider?: RiderSettings; drivetrain?: DrivetrainSettings }): void {
    if (settings.rider) this.rider = settings.rider
    if (settings.drivetrain) this.drivetrain = settings.drivetrain
    this.notify()
  }

  setRoute(route: Route): void {
    this.route = route
    this.reset()
    this.status = 'ready'
    this.notify()
  }

  /** The loaded route, for drawing the profile and the map. */
  get currentRoute(): Route | null {
    return this.route
  }

  // --- control ------------------------------------------------------------

  start(): void {
    if (!this.route || this.status === 'riding') return
    if (this.status === 'finished' || this.status === 'ready') this.reset()
    this.status = 'riding'
    this.lastTickMs = null
    this.notify()
  }

  pause(): void {
    if (this.status !== 'riding') return
    this.status = 'paused'
    this.autoPaused = false
    this.notify()
  }

  resume(): void {
    if (this.status !== 'paused') return
    this.status = 'riding'
    this.autoPaused = false
    this.idleMs = 0
    this.notify()
  }

  end(): void {
    if (this.status === 'idle') return
    this.status = 'finished'
    this.motion = { ...this.motion, speed: 0 }
    this.pushGradient(0)
    this.notify()
  }

  shift(direction: 1 | -1): void {
    this.setGear(shiftGear(this.gear, direction))
  }

  setGear(gear: number): void {
    const next = clampGear(gear)
    if (next === this.gear) return
    this.gear = next
    // Take effect now rather than at the next tick: a shift should be felt
    // straight away, not up to a quarter second later.
    this.pushGradient(this.computeTrainerGradient())
    this.notify()
  }

  // --- the loop -----------------------------------------------------------

  tick(nowMs: number): void {
    const previous = this.lastTickMs
    this.lastTickMs = nowMs

    const route = this.route
    if (!route || previous === null) return
    if (this.status !== 'riding' && this.status !== 'paused') return

    const dtSeconds = Math.max(0, (nowMs - previous) / 1000)

    if (this.status === 'paused') {
      if (this.autoPaused && (this.latest.powerW ?? 0) > 0) this.resume()
      this.notify()
      return
    }

    this.elapsedMs += dtSeconds * 1000

    const routeGradient = route.gradientAt(this.motion.distance)
    this.motion = stepMotion(
      this.motion,
      { powerW: this.latest.powerW ?? 0, gradientPct: routeGradient, dtSeconds },
      this.rider,
    )

    this.trackClimbing()

    if (this.motion.distance >= route.totalDistance) {
      this.motion = { speed: 0, distance: route.totalDistance }
      this.status = 'finished'
      this.pushGradient(0)
      this.notify()
      return
    }

    this.checkAutoPause(dtSeconds)
    this.pushGradient(this.computeTrainerGradient())
    this.notify()
  }

  // --- reading ------------------------------------------------------------

  subscribe(listener: (snapshot: RideSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  snapshot(): RideSnapshot {
    const position = this.route?.pointAt(this.motion.distance)

    return {
      status: this.status,
      routeName: this.route?.name ?? null,
      distance: this.motion.distance,
      routeDistance: this.route?.totalDistance ?? 0,
      speedMs: this.motion.speed,
      powerW: this.latest.powerW ?? 0,
      cadenceRpm: this.latest.cadenceRpm ?? 0,
      gear: this.gear,
      gearRatio: gearRatio(this.gear),
      relativeRatio: relativeRatio(this.gear, this.drivetrain),
      routeGradient: position?.gradient ?? 0,
      trainerGradient: this.trainerGradient,
      elapsedSeconds: this.elapsedMs / 1000,
      elevation: position?.ele ?? 0,
      climbed: this.climbed,
      routeAscent: this.route?.totalAscent ?? 0,
      lat: position?.lat ?? 0,
      lon: position?.lon ?? 0,
    }
  }

  // --- internals ----------------------------------------------------------

  private reset(): void {
    this.motion = MOTION_AT_REST
    this.elapsedMs = 0
    this.climbed = 0
    this.idleMs = 0
    this.lastElevation = this.route?.points[0]?.ele ?? null
    this.trainerGradient = 0
  }

  private onTrainerData(data: TrainerData): void {
    this.latest = { ...this.latest, ...data }
    this.notify()
  }

  private computeTrainerGradient(): number {
    if (!this.route) return 0
    return adjustedGradient(
      this.route.gradientAt(this.motion.distance),
      this.motion.speed,
      relativeRatio(this.gear, this.drivetrain),
      this.rider,
    )
  }

  private pushGradient(gradientPct: number): void {
    this.trainerGradient = gradientPct
    const trainer = this.trainer
    if (!trainer) return
    // Called every tick by design: the device layer knows its own link rate
    // and coalesces. Failures surface through the device's own state.
    trainer.setSimulation(gradientPct).catch((error: unknown) => this.onerror?.(error))
  }

  private trackClimbing(): void {
    const elevation = this.route?.pointAt(this.motion.distance).ele
    if (elevation === undefined) return
    if (this.lastElevation !== null && elevation > this.lastElevation) {
      this.climbed += elevation - this.lastElevation
    }
    this.lastElevation = elevation
  }

  private checkAutoPause(dtSeconds: number): void {
    if (this.autoPauseSeconds <= 0) return

    const stopped = (this.latest.powerW ?? 0) <= 0 && this.motion.speed < STOPPED_SPEED_MS
    if (!stopped) {
      this.idleMs = 0
      return
    }

    this.idleMs += dtSeconds * 1000
    if (this.idleMs >= this.autoPauseSeconds * 1000) {
      this.status = 'paused'
      this.autoPaused = true
      this.idleMs = 0
    }
  }

  private notify(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
