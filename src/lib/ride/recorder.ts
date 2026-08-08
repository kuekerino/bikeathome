/**
 * Turns the live ride engine into a track log: samples the snapshot at 1 Hz
 * while riding, so a paused or idle ride does not pad the recording with
 * stationary points.
 *
 * Time is injected via `nowMs` rather than read from `Date.now()`, so the
 * throttling can be driven deterministically in tests.
 */

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
}

/** Samples closer together than this add no signal a TCX consumer needs. */
const SAMPLE_INTERVAL_MS = 1000

export class RideRecorder {
  private recorded: RideSample[] = []
  private lastSampleMs: number | null = null

  record(snapshot: RideSnapshot, nowMs: number): void {
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
