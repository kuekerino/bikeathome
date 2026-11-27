/**
 * Turns the live ride engine into a track log: samples the snapshot at 1 Hz
 * while riding, so a paused or idle ride does not pad the recording with
 * stationary points.
 *
 * Time is injected via `nowMs` rather than read from `Date.now()`, so the
 * throttling can be driven deterministically in tests.
 */

import type { RiderSettings } from '../physics/constants'
import type { DrivetrainSettings } from '../physics/gears'
import type { RideSnapshot } from './engine'

export interface RideSample {
  /** Milliseconds since epoch. */
  time: number
  distanceM: number
  lat: number
  lon: number
  altitudeM: number
  powerW: number
  cadenceRpm: number
  speedMs: number
  /** Absent when no strap was reporting at that moment. */
  heartRateBpm?: number
  /**
   * What the app did with the trainer at that moment. Absent in rides recorded
   * before it was kept.
   */
  trace?: TrainerTrace
}

/**
 * Everything needed to understand a ride afterwards, not just replay it.
 *
 * A TCX says how hard and how fast. It cannot say which gear the rider was in,
 * what the trainer was asked for, or which settings that was worked out from,
 * and without those a ride report like "the climbs were too heavy in the
 * lowest gear" has to be answered by guessing the gear back out of the watts.
 * None of this goes into the TCX, which has no place for it; the CSV export
 * carries it.
 */
export interface TrainerTrace {
  gear: number
  /** The virtual gear's own ratio. */
  gearRatio: number
  /** Its ratio against the gear the bike is physically in. 1 in cassette mode. */
  relativeRatio: number
  routeGradientPct: number
  /** The slope the trainer was told to simulate. Zero while holding a power. */
  trainerGradientPct: number
  /** Watts the trainer was told to hold, or `null` while it followed the slope. */
  heldPowerW: number | null
  /**
   * The trainer's own wheel speed, or `null` when it reports none. Against the
   * cadence, it says which chainring the chain was really on.
   */
  trainerSpeedKmh: number | null
  mode: DrivetrainSettings['mode']
  chainringTeeth: number
  cogTeeth: number
  hillFeelPct: number
  massKg: number
  crr: number
  cda: number
}

/** The settings a sample was worked out from. */
export interface RideSetup {
  rider: RiderSettings
  drivetrain: DrivetrainSettings
}

/** Samples closer together than this add no signal a TCX consumer needs. */
const SAMPLE_INTERVAL_MS = 1000

export class RideRecorder {
  private recorded: RideSample[] = []
  private lastSampleMs: number | null = null

  /**
   * @param setup the rider and drivetrain settings in force, so the sample
   * says what its gear meant. Without it the sample carries no trace.
   */
  record(snapshot: RideSnapshot, nowMs: number, setup?: RideSetup): void {
    if (snapshot.status !== 'riding') return
    if (this.lastSampleMs !== null && nowMs - this.lastSampleMs < SAMPLE_INTERVAL_MS) return

    this.lastSampleMs = nowMs
    this.recorded.push({
      time: nowMs,
      distanceM: snapshot.distance,
      lat: snapshot.lat,
      lon: snapshot.lon,
      altitudeM: snapshot.elevation,
      powerW: snapshot.powerW,
      cadenceRpm: snapshot.cadenceRpm,
      speedMs: snapshot.speedMs,
      ...(snapshot.heartRateBpm === null ? {} : { heartRateBpm: snapshot.heartRateBpm }),
      ...(setup ? { trace: traceOf(snapshot, setup) } : {}),
    })
  }

  reset(): void {
    this.recorded = []
    this.lastSampleMs = null
  }

  get samples(): readonly RideSample[] {
    return this.recorded
  }

  get isEmpty(): boolean {
    return this.recorded.length === 0
  }

  get startedAt(): number | null {
    return this.recorded[0]?.time ?? null
  }
}

function traceOf(snapshot: RideSnapshot, { rider, drivetrain }: RideSetup): TrainerTrace {
  return {
    gear: snapshot.gear,
    gearRatio: snapshot.gearRatio,
    relativeRatio: snapshot.relativeRatio,
    routeGradientPct: snapshot.routeGradient,
    trainerGradientPct: snapshot.trainerGradient,
    heldPowerW: snapshot.heldPowerW,
    trainerSpeedKmh: snapshot.trainerSpeedKmh,
    mode: drivetrain.mode,
    chainringTeeth: drivetrain.chainringTeeth,
    cogTeeth: drivetrain.cogTeeth,
    hillFeelPct: drivetrain.hillFeelPct,
    massKg: rider.massKg,
    crr: rider.crr,
    cda: rider.cda,
  }
}
