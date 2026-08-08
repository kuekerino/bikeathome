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
import {
  DEFAULT_HEART_RATE_CAP,
  isOverCeiling,
  nextAppliedPower,
  type HeartRateCapSettings,
} from './heartRateCap'
import type { Shifter, Trainer, TrainerData } from '../ble/types'
import { POWER_STEP, type RideAction } from '../controls/actions'
import { DEFAULT_BINDINGS, type Bindings } from '../controls/bindings'

export type RideStatus = 'idle' | 'ready' | 'riding' | 'paused' | 'finished'

/**
 * Riding a loaded route, or just pedalling.
 *
 * Free ride is not a route with the interesting parts removed — it is flat and
 * endless, so there is no gradient, no elevation and nothing to finish. The
 * physics is the same either way, which is what keeps the speed honest: 160 W
 * on the flat covers the ground it would cover on the road.
 */
export type RideMode = 'route' | 'free'

/** Below this, with no power, the rider counts as stopped. */
const STOPPED_SPEED_MS = 0.5

/** Nobody is holding 2 kW, and a typo should not be sent to a flywheel. */
export const POWER_LIMITS = { min: 0, max: 2000 } as const

export interface RideSnapshot {
  status: RideStatus
  mode: RideMode
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
  /** Watts the rider asked to hold, or `null` when simulating the gradient. */
  targetPowerW: number | null
  /**
   * Watts actually being sent. Below the target when the heart rate ceiling
   * has pulled it down, equal to it otherwise.
   */
  heldPowerW: number | null
  heartRateBpm: number | null
  /** The rate is over the ceiling right now. */
  overCeiling: boolean
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
  heartRateCap?: HeartRateCapSettings
  /** Seconds of not pedalling before the clock stops. Zero disables it. */
  autoPauseSeconds?: number
}

export class RideEngine {
  rider: RiderSettings
  drivetrain: DrivetrainSettings
  bindings: Bindings
  heartRateCap: HeartRateCapSettings
  autoPauseSeconds: number

  /** Reports a failed write to the trainer; the device reports link state itself. */
  onerror: ((error: unknown) => void) | null = null

  private route: Route | null = null
  private mode: RideMode = 'route'
  private status: RideStatus = 'idle'
  private motion: MotionState = MOTION_AT_REST
  private gear = DEFAULT_GEAR
  private latest: TrainerData = {}
  private trainerGradient = 0
  private targetPowerW: number | null = null
  /** What the ceiling has actually left of the target. */
  private appliedPowerW: number | null = null
  private heartRateBpm: number | null = null
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
    this.heartRateCap = options.heartRateCap ?? DEFAULT_HEART_RATE_CAP
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
    this.mode = 'route'
    this.reset()
    this.status = 'ready'
    this.notify()
  }

  /** Flat, endless, no route: set a power and pedal. */
  setFreeRide(): void {
    this.route = null
    this.mode = 'free'
    this.reset()
    this.status = 'ready'
    this.notify()
  }

  /** The loaded route, for drawing the profile and the map. */
  get currentRoute(): Route | null {
    return this.route
  }

  /** Whether there is anything to ride: a loaded route, or free ride chosen. */
  get ridable(): boolean {
    return this.mode === 'free' || this.route !== null
  }

  // --- control ------------------------------------------------------------

  start(): void {
    if (!this.ridable || this.status === 'riding') return
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
    // A manual change is an instruction, not a suggestion: drop any hold-back
    // rather than easing towards the new number.
    this.appliedPowerW = next
    // Recompute rather than reuse: while holding a power the tracked gradient
    // is zero, so pushing it as-is would send a flat road on the way out — for
    // up to a tick, in the middle of a climb.
    this.pushGradient(this.computeTrainerGradient())
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

  /** The latest strap reading. `null` clears it when the strap goes away. */
  setHeartRate(bpm: number | null): void {
    this.heartRateBpm = bpm
    this.notify()
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
    if (previous === null || !this.ridable) return
    if (this.status !== 'riding' && this.status !== 'paused') return

    const dtSeconds = Math.max(0, (nowMs - previous) / 1000)

    if (this.status === 'paused') {
      if (this.autoPaused && (this.latest.powerW ?? 0) > 0) this.resume()
      this.notify()
      return
    }

    this.elapsedMs += dtSeconds * 1000

    const routeGradient = route?.gradientAt(this.motion.distance) ?? 0
    this.motion = stepMotion(
      this.motion,
      { powerW: this.latest.powerW ?? 0, gradientPct: routeGradient, dtSeconds },
      this.rider,
    )

    this.trackClimbing()

    if (route && this.motion.distance >= route.totalDistance) {
      this.motion = { speed: 0, distance: route.totalDistance }
      this.status = 'finished'
      this.pushGradient(0)
      this.notify()
      return
    }

    this.checkAutoPause(dtSeconds)
    this.applyHeartRateCap(dtSeconds)
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
      mode: this.mode,
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
      heldPowerW:
        this.targetPowerW === null
          ? null
          : Math.round(this.appliedPowerW ?? this.targetPowerW),
      heartRateBpm: this.heartRateBpm,
      overCeiling: isOverCeiling(this.heartRateBpm, this.heartRateCap),
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
    if (!this.ridable) return 0
    // Free ride is flat, but the gear still scales what the legs feel, exactly
    // as it would on a flat road.
    return adjustedGradient(
      this.route?.gradientAt(this.motion.distance) ?? 0,
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

  /**
   * Pulls the target down while the heart rate is over the ceiling, and lets
   * it back up once it is clear. Only ever takes away.
   */
  private applyHeartRateCap(dtSeconds: number): void {
    if (this.targetPowerW === null) {
      this.appliedPowerW = null
      return
    }
    this.appliedPowerW = nextAppliedPower(
      {
        chosenW: this.targetPowerW,
        appliedW: this.appliedPowerW ?? this.targetPowerW,
        heartRateBpm: this.heartRateBpm,
        dtSeconds,
      },
      this.heartRateCap,
    )
  }

  private pushResistance(): void {
    const trainer = this.trainer
    if (!trainer) return

    const failed = (error: unknown) => this.onerror?.(error)

    if (this.targetPowerW !== null) {
      this.ergEngaged = true
      // Whole watts: FTMS carries no fraction, and the controller works in
      // real numbers so it can move slower than one watt per tick.
      const watts = Math.round(this.appliedPowerW ?? this.targetPowerW)
      trainer.setTargetPower(watts).catch(failed)
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
