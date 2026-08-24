/**
 * Boiling a recorded ride down to the line you would read a week later.
 *
 * Pure, and kept apart from storage: the arithmetic is the part worth testing,
 * and IndexedDB is the part that cannot be.
 */

import type { RideSample } from '../ride/recorder'
import type { Workout } from '../workout/model'

/** What the ride was, beyond the numbers the samples already carry. */
export interface RideContext {
  routeName: string | null
  workout: Workout | null
  /** 'route' or 'free', from the engine. */
  mode: 'route' | 'free'
  climbedM: number
}

export interface RideSummary {
  /** The start time in milliseconds, which is also the record's key. */
  id: number
  startedAt: number
  name: string
  mode: 'route' | 'free'
  seconds: number
  distanceM: number
  climbedM: number
  averagePowerW: number
  maxPowerW: number
  averageCadenceRpm: number
  /** Absent when no strap was connected. */
  averageHeartRateBpm?: number
  maxHeartRateBpm?: number
  /** Present when the ride followed a workout, so it can be ridden again. */
  workoutName?: string
  sampleCount: number
}

export function summarise(
  samples: readonly RideSample[],
  context: RideContext,
): RideSummary | null {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last) return null

  const powers = samples.map((s) => s.powerW)
  const cadences = samples.map((s) => s.cadenceRpm)
  // Only the samples that actually carried a reading: averaging a strap that
  // joined halfway against zeros would report a heart rate nobody had.
  const rates = samples
    .map((s) => s.heartRateBpm)
    .filter((bpm): bpm is number => bpm !== undefined)

  return {
    id: first.time,
    startedAt: first.time,
    name: rideName(context),
    mode: context.mode,
    seconds: Math.round((last.time - first.time) / 1000),
    distanceM: last.distanceM,
    climbedM: Math.round(context.climbedM),
    averagePowerW: Math.round(mean(powers)),
    maxPowerW: Math.round(Math.max(...powers)),
    averageCadenceRpm: Math.round(mean(cadences)),
    ...(rates.length > 0
      ? {
          averageHeartRateBpm: Math.round(mean(rates)),
          maxHeartRateBpm: Math.round(Math.max(...rates)),
        }
      : {}),
    ...(context.workout ? { workoutName: context.workout.name } : {}),
    sampleCount: samples.length,
  }
}

function rideName(context: RideContext): string {
  // The most specific thing that is true. A workout ridden on a route is
  // remembered by the workout, because that is what you would look for.
  if (context.workout) return context.workout.name
  if (context.routeName) return context.routeName
  return context.mode === 'free' ? 'Just pedalling' : 'Unnamed route'
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

/** "Tue 8 Aug, 10:50" — enough to recognise a ride, short enough for a list. */
export function formatWhen(startedAt: number): string {
  return new Date(startedAt).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')}`
  // "0 min" tells a rider who stopped after twenty seconds nothing at all.
  if (minutes === 0) return `${total} s`
  return `${minutes} min`
}
