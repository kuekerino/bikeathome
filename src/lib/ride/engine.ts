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
import { POWER_STEP, type RideAction } from '../controls/actions'
import { DEFAULT_BINDINGS, type Bindings } from '../controls/bindings'

export type RideStatus = 'idle' | 'ready' | 'riding' | 'paused' | 'finished'

/** Below this, with no power, the rider counts as stopped. */
const STOPPED_SPEED_MS = 0.5

/** Nobody is holding 2 kW, and a typo should not be sent to a flywheel. */
export const POWER_LIMITS = { min: 0, max: 2000 } as const

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
  /** Watts the trainer is being told to hold, or `null` when simulating. */
  targetPowerW: number | null
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
  bindings?: Bindings
  /** Seconds of not pedalling before the clock stops. Zero disables it. */
  autoPauseSeconds?: number
}

export class RideEngine {
  rider: RiderSettings
  drivetrain: DrivetrainSettings
  bindings: Bindings
  autoPauseSeconds: number

  /** Reports a failed write to the trainer; the device reports link state itself. */
  onerror: ((error: unknown) => void) | null = null

  private route: Route | null = null
  private status: RideStatus = 'idle'
  private motion: MotionState = MOTION_AT_REST
  private gear = DEFAULT_GEAR
  private latest: TrainerData = {}
  private trainerGradient = 0
  private targetPowerW: number | null = null
  /** Whether the trainer was last told to hold a power rather than a slope. */
  private ergEngaged = false
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
  private readonly shifters = new Set<Shifter>()
  private readonly listeners = new Set<(snapshot: RideSnapshot) => void>()

  constructor(options: RideEngineOptions = {}) {
    this.rider = options.rider ?? DEFAULT_RIDER
    this.drivetrain = options.drivetrain ?? DEFAULT_DRIVETRAIN
    this.bindings = options.bindings ?? DEFAULT_BINDINGS
    this.autoPauseSeconds = options.autoPauseSeconds ?? 5
  }

  // --- wiring -------------------------------------------------------------

  attachTrainer(trainer: Trainer | null): void {
    if (this.trainer) this.trainer.ondata = null
    this.trainer = trainer
    if (trainer) trainer.ondata = (data) => this.onTrainerData(data)
    this.notify()
  }

  /**
   * Several shifters can be live at once, which is the point: the keyboard
   * stays usable with a Click paired, so a dropout mid-climb is an
   * inconvenience rather than the end of the ride.
   *
   * Returns a function that detaches this one.
   */
  addShifter(shifter: Shifter): () => void {
    this.shifters.add(shifter)
    // A shifter reports which of its two buttons was pressed. What that button
    // means is the rider's to decide, so it goes through the bindings rather
    // than straight to the gears.
    shifter.onshift = (direction) =>
      this.perform(direction === 1 ? this.bindings.click.up : this.bindings.click.down)
    this.notify()

    return () => {
      shifter.onshift = null
      this.shifters.delete(shifter)
      this.notify()
    }
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

  /** Runs whatever a key or a button was bound to. */
  perform(action: RideAction): void {
    const step = POWER_STEP[action]
    if (step !== undefined) {
      this.nudgeTargetPower(step)
      return
    }

    switch (action) {
      case 'shiftUp':
        this.shift(1)
        return
      case 'shiftDown':
        this.shift(-1)
        return
      case 'togglePower':
        this.setTargetPower(
          this.targetPowerW === null ? Math.max(50, Math.round(this.latest.powerW ?? 150)) : null,
        )
        return
      case 'togglePause':
        if (this.status === 'riding') this.pause()
        else if (this.status === 'paused') this.resume()
        else this.start()
        return
      case 'nothing':
        return
    }
  }

  /**
   * Holds a fixed wattage instead of simulating the slope — ERG. `null` gives
   * the gradient back.
   *
   * Speed is unaffected in the sense that matters: it still comes from the
   * watts the trainer reports and the route's real gradient. ERG changes what
   * the legs feel, not where the rider ends up.
   */
  setTargetPower(watts: number | null): void {
    const next =
      watts === null
        ? null
        : Math.round(Math.min(POWER_LIMITS.max, Math.max(POWER_LIMITS.min, watts)))
    if (next === this.targetPowerW) return

    this.targetPowerW = next
    this.pushResistance()
    this.notify()
  }

  /** Steps the target by `delta` watts, starting from the current effort. */
  nudgeTargetPower(delta: number): void {
    const from = this.targetPowerW ?? Math.round(this.latest.powerW ?? 0)
    this.setTargetPower(from + delta)
  }

  get targetPower(): number | null {
    return this.targetPowerW
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
      targetPowerW: this.targetPowerW,
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

  /**
   * Sends whichever kind of resistance is in force. ERG wins when set: the
   * gradient is still tracked for the dashboard but never reaches the trainer,
   * because a trainer cannot be in both modes at once.
   */
  private pushGradient(gradientPct: number): void {
    this.trainerGradient = this.targetPowerW === null ? gradientPct : 0
    this.pushResistance()
  }

  private pushResistance(): void {
    const trainer = this.trainer
    if (!trainer) return

    const failed = (error: unknown) => this.onerror?.(error)

    if (this.targetPowerW !== null) {
      this.ergEngaged = true
      trainer.setTargetPower(this.targetPowerW).catch(failed)
      return
    }

    // Leaving ERG is announced once rather than on every tick: a gradient
    // frame is the thing that has to stay immediate, since a shift is felt as
    // soon as it is sent.
    if (this.ergEngaged) {
      this.ergEngaged = false
      trainer.setTargetPower(null).catch(failed)
    }
    // Called every tick by design: the device layer knows its own link rate
    // and coalesces. Failures surface through the device's own state.
    trainer.setSimulation(this.trainerGradient).catch(failed)
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
