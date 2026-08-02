/**
 * Route model: turns raw GPX points into a distance-indexed profile that the
 * ride engine can query as the rider advances.
 *
 * Pure — no DOM, no Bluetooth. Distances are metres, gradients are percent.
 */

import type { ParsedGpx, RawPoint } from './parser'

export const EARTH_RADIUS_M = 6371000

/** Points closer together than this carry no useful signal and only add noise. */
const MIN_SEGMENT_M = 1

/** Raw GPS elevation is noisy enough that per-segment gradients are meaningless without this. */
const SMOOTHING_HALF_WINDOW_M = 25

/** Beyond this, a gradient is almost certainly a GPS artefact rather than a real wall. */
const MAX_GRADIENT_PCT = 25

export interface LatLon {
  lat: number
  lon: number
}

export interface RoutePoint extends LatLon {
  /** Smoothed elevation in metres. */
  ele: number
  /** Cumulative distance from the start, in metres. */
  distance: number
}

export interface RoutePosition extends LatLon {
  ele: number
  distance: number
  /** Gradient of the segment the position falls in, in percent. */
  gradient: number
}

export class RouteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RouteError'
  }
}

export function haversineMetres(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const deltaLat = lat2 - lat1
  const deltaLon = toRadians(b.lon - a.lon)

  const chord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(chord)))
}

export class Route {
  readonly name: string | null
  readonly points: readonly RoutePoint[]
  /** `gradients[i]` applies from `points[i]` to `points[i + 1]`. */
  readonly gradients: readonly number[]
  readonly totalDistance: number
  readonly totalAscent: number
  readonly hasElevation: boolean

  private constructor(init: {
    name: string | null
    points: RoutePoint[]
    gradients: number[]
    totalAscent: number
    hasElevation: boolean
  }) {
    this.name = init.name
    this.points = init.points
    this.gradients = init.gradients
    this.totalDistance = init.points[init.points.length - 1]!.distance
    this.totalAscent = init.totalAscent
    this.hasElevation = init.hasElevation
  }

  static from(parsed: ParsedGpx): Route {
    const measured = accumulate(parsed.points)
    if (measured.length < 2) {
      throw new RouteError('Route needs at least two points more than a metre apart.')
    }

    const smoothed = smoothElevation(measured, SMOOTHING_HALF_WINDOW_M)
    const points: RoutePoint[] = measured.map((entry, i) => ({
      lat: entry.lat,
      lon: entry.lon,
      ele: smoothed[i]!,
      distance: entry.distance,
    }))

    const gradients: number[] = []
    let totalAscent = 0
    for (let i = 0; i < points.length - 1; i++) {
      const run = points[i + 1]!.distance - points[i]!.distance
      const rise = points[i + 1]!.ele - points[i]!.ele
      if (rise > 0) totalAscent += rise
      gradients.push(clamp((rise / run) * 100, -MAX_GRADIENT_PCT, MAX_GRADIENT_PCT))
    }

    return new Route({
      name: parsed.name,
      points,
      gradients,
      totalAscent,
      hasElevation: parsed.hasElevation,
    })
  }

  /** Gradient in percent at a distance along the route, clamped to the route's extent. */
  gradientAt(distance: number): number {
    return this.gradients[this.segmentAt(distance)]!
  }

  /** Interpolated position at a distance along the route, clamped to its extent. */
  pointAt(distance: number): RoutePosition {
    const i = this.segmentAt(distance)
    const from = this.points[i]!
    const to = this.points[i + 1]!
    const span = to.distance - from.distance
    const t = clamp(span > 0 ? (distance - from.distance) / span : 0, 0, 1)

    return {
      lat: lerp(from.lat, to.lat, t),
      lon: lerp(from.lon, to.lon, t),
      ele: lerp(from.ele, to.ele, t),
      distance: clamp(distance, 0, this.totalDistance),
      gradient: this.gradients[i]!,
    }
  }

  /** Index of the segment containing `distance`, clamped into range. */
  private segmentAt(distance: number): number {
    const last = this.gradients.length - 1
    if (!(distance > 0)) return 0
    if (distance >= this.totalDistance) return last

    let low = 0
    let high = last
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (this.points[mid]!.distance <= distance) low = mid
      else high = mid - 1
    }
    return low
  }
}

interface MeasuredPoint extends RawPoint {
  distance: number
}

/** Cumulative distance along the track, dropping points too close to matter. */
function accumulate(raw: RawPoint[]): MeasuredPoint[] {
  if (raw.length === 0) return []

  const first = raw[0]!
  const out: MeasuredPoint[] = [{ ...first, distance: 0 }]
  let cursor: RawPoint = first
  let total = 0

  for (let i = 1; i < raw.length; i++) {
    const point = raw[i]!
    const step = haversineMetres(cursor, point)
    if (step < MIN_SEGMENT_M) continue
    total += step
    out.push({ ...point, distance: total })
    cursor = point
  }

  return out
}

/**
 * Distance-weighted moving average of elevation over a window either side of
 * each point. Weighting by each point's share of the track keeps sparse
 * stretches from being drowned out by densely sampled ones.
 */
function smoothElevation(points: MeasuredPoint[], halfWindow: number): number[] {
  const weights = influenceLengths(points)
  const out: number[] = []

  // Window bounds only ever move forward, so both cursors advance monotonically.
  let low = 0
  let high = 0

  for (let i = 0; i < points.length; i++) {
    const from = points[i]!.distance - halfWindow
    const to = points[i]!.distance + halfWindow
    while (low < points.length && points[low]!.distance < from) low++
    while (high < points.length && points[high]!.distance <= to) high++

    let weighted = 0
    let total = 0
    for (let j = low; j < high; j++) {
      weighted += points[j]!.ele * weights[j]!
      total += weights[j]!
    }
    out.push(total > 0 ? weighted / total : points[i]!.ele)
  }

  return out
}

/** How much of the track each point speaks for: half the gap either side. */
function influenceLengths(points: MeasuredPoint[]): number[] {
  return points.map((point, i) => {
    const before = i > 0 ? point.distance - points[i - 1]!.distance : 0
    const after = i < points.length - 1 ? points[i + 1]!.distance - point.distance : 0
    return Math.max((before + after) / 2, 0.1)
  })
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
