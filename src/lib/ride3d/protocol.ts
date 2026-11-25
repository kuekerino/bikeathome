/**
 * What bikeathome and its 3D view say to each other.
 *
 * The view runs in a frame of the same page. It asks for its course once,
 * when it has loaded, and is then told where the rider is four times a
 * second. It never talks to the trainer and decides nothing: speed, distance
 * and resistance all come from the ride engine, so a ride in 3D records and
 * exports exactly like any other.
 */

import type { Course } from '../course/course'
import type { RideSnapshot, RideStatus } from '../ride/engine'

/** The view, loaded and waiting for its course. */
export interface ReadyMessage {
  type: 'ready'
}

/** The course to build, or null for the invented valley. */
export interface CourseMessage {
  type: 'course'
  course: Course | null
}

export interface RideUpdate {
  type: 'ride'
  status: RideStatus
  /** Metres along the route, or ridden so far when there is no route. */
  distance: number
  routeDistance: number
  speedMs: number
  powerW: number
  cadenceRpm: number
  /** The route's gradient where the rider is, percent: what the road does, before any gearing. */
  gradient: number
  /** Null in cassette mode, where the gears are on the bike. */
  gear: number | null
  /** Null unless a power is being held. */
  targetPowerW: number | null
  heartRateBpm: number | null
}

export type ToView = CourseMessage | RideUpdate
export type FromView = ReadyMessage

export function rideUpdate(ride: RideSnapshot, virtualShifting: boolean): RideUpdate {
  return {
    type: 'ride',
    status: ride.status,
    distance: ride.distance,
    routeDistance: ride.routeDistance,
    speedMs: ride.speedMs,
    powerW: ride.powerW,
    cadenceRpm: ride.cadenceRpm,
    gradient: ride.routeGradient,
    gear: virtualShifting ? ride.gear : null,
    targetPowerW: ride.heldPowerW,
    heartRateBpm: ride.heartRateBpm,
  }
}

/** Only messages from this page's own origin are listened to, in both directions. */
export function isFromView(event: MessageEvent, origin: string): event is MessageEvent<FromView> {
  return event.origin === origin && typeof event.data === 'object' && event.data?.type === 'ready'
}
