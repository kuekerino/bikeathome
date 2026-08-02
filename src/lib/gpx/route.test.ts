import { describe, expect, it } from 'vitest'
import type { ParsedGpx } from './parser'
import { EARTH_RADIUS_M, haversineMetres, Route, RouteError } from './route'

const METRES_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_M) / 180

/**
 * A route running due north from a fixed point. Along a meridian the
 * haversine distance is exactly R * deltaLat, so expected distances are known
 * to full precision rather than approximated.
 */
function northward(spacingM: number, elevations: number[]): ParsedGpx {
  const step = spacingM / METRES_PER_DEGREE_LAT
  return {
    name: 'Test route',
    hasElevation: true,
    points: elevations.map((ele, i) => ({ lat: 47 + i * step, lon: 11, ele })),
  }
}

describe('haversineMetres', () => {
  it('is zero for the same point', () => {
    expect(haversineMetres({ lat: 47, lon: 11 }, { lat: 47, lon: 11 })).toBe(0)
  })

  it('measures a thousandth of a degree of latitude as ~111.19 m', () => {
    const d = haversineMetres({ lat: 47, lon: 11 }, { lat: 47.001, lon: 11 })
    expect(d).toBeCloseTo(111.1949, 3)
  })

  it('measures longitude at the equator the same as latitude', () => {
    const alongLat = haversineMetres({ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 })
    const alongLon = haversineMetres({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 })
    expect(alongLon).toBeCloseTo(alongLat, 6)
  })

  it('shrinks longitude distance with latitude', () => {
    const equator = haversineMetres({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })
    const north = haversineMetres({ lat: 60, lon: 0 }, { lat: 60, lon: 1 })
    // cos(60 degrees) = 0.5
    expect(north / equator).toBeCloseTo(0.5, 3)
  })
})

describe('Route geometry', () => {
  it('accumulates distance along the track', () => {
    const route = Route.from(northward(100, [0, 5, 10]))
    expect(route.points).toHaveLength(3)
    expect(route.points[1]!.distance).toBeCloseTo(100, 6)
    expect(route.totalDistance).toBeCloseTo(200, 6)
  })

  it('drops points closer together than a metre', () => {
    const halfMetre = 0.5 / METRES_PER_DEGREE_LAT
    const hundredMetres = 100 / METRES_PER_DEGREE_LAT
    const route = Route.from({
      name: null,
      hasElevation: true,
      points: [
        { lat: 47, lon: 11, ele: 0 },
        { lat: 47 + halfMetre, lon: 11, ele: 0 },
        { lat: 47 + hundredMetres, lon: 11, ele: 0 },
      ],
    })
    expect(route.points).toHaveLength(2)
    expect(route.totalDistance).toBeCloseTo(100, 6)
  })

  it('rejects a route that collapses to a single point', () => {
    expect(() =>
      Route.from({
        name: null,
        hasElevation: true,
        points: [
          { lat: 47, lon: 11, ele: 0 },
          { lat: 47, lon: 11, ele: 0 },
        ],
      }),
    ).toThrow(RouteError)
  })
})

describe('Route gradients', () => {
  it('computes a constant climb', () => {
    // 100 m spacing keeps every point outside its neighbours' smoothing
    // window, so these gradients are exact rather than averaged.
    const route = Route.from(northward(100, [0, 5, 10]))
    expect(route.gradients).toHaveLength(2)
    expect(route.gradients[0]!).toBeCloseTo(5, 6)
    expect(route.gradients[1]!).toBeCloseTo(5, 6)
    expect(route.totalAscent).toBeCloseTo(10, 6)
  })

  it('signs descents negative and leaves them out of total ascent', () => {
    const route = Route.from(northward(100, [10, 5, 0]))
    expect(route.gradients[0]!).toBeCloseTo(-5, 6)
    expect(route.totalAscent).toBeCloseTo(0, 6)
  })

  it('clamps implausible gradients', () => {
    const route = Route.from(northward(60, [0, 30]))
    expect(route.gradients[0]!).toBe(25)
  })

  it('smooths elevation spikes', () => {
    const elevations = [100, 100, 100, 100, 100, 150, 100, 100, 100, 100, 100]
    const route = Route.from(northward(10, elevations))
    // The spike is averaged across the five points within +/-25 m:
    // (100 + 100 + 150 + 100 + 100) / 5
    expect(route.points[5]!.ele).toBeCloseTo(110, 6)
    expect(route.points[0]!.ele).toBeLessThan(110)
  })

  it('reports flat gradients when the file had no elevation', () => {
    const route = Route.from({ ...northward(100, [0, 0, 0]), hasElevation: false })
    expect(route.hasElevation).toBe(false)
    expect(route.gradients.every((g) => g === 0)).toBe(true)
  })
})

describe('Route lookups', () => {
  const route = Route.from(northward(100, [0, 5, 10]))

  it('interpolates position within a segment', () => {
    const at = route.pointAt(50)
    expect(at.ele).toBeCloseTo(2.5, 6)
    expect(at.gradient).toBeCloseTo(5, 6)
    expect(at.lat).toBeCloseTo((route.points[0]!.lat + route.points[1]!.lat) / 2, 9)
  })

  it('returns the right segment either side of a boundary', () => {
    expect(route.pointAt(99).distance).toBeCloseTo(99, 6)
    expect(route.pointAt(101).distance).toBeCloseTo(101, 6)
  })

  it('clamps before the start and past the end', () => {
    expect(route.pointAt(-50).distance).toBe(0)
    expect(route.pointAt(-50).ele).toBeCloseTo(0, 6)

    const past = route.pointAt(10_000)
    expect(past.distance).toBeCloseTo(route.totalDistance, 6)
    expect(past.ele).toBeCloseTo(10, 6)
  })

  it('reports a gradient anywhere on the route', () => {
    expect(route.gradientAt(-1)).toBeCloseTo(5, 6)
    expect(route.gradientAt(150)).toBeCloseTo(5, 6)
    expect(route.gradientAt(10_000)).toBeCloseTo(5, 6)
  })

  it('finds the correct segment on a longer route', () => {
    const long = Route.from(northward(100, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
    for (let i = 0; i < 9; i++) {
      expect(long.pointAt(i * 100 + 50).ele).toBeCloseTo(i + 0.5, 6)
    }
  })
})
