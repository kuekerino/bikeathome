// @vitest-environment jsdom

/**
 * End-to-end check over the bundled demo route: real file, real parse, real
 * route model. Guards the demo the app ships with, and exercises the parser
 * against a file with hundreds of points rather than a hand-built fixture.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGpx } from './parser'
import { Route } from './route'

// Resolved from the project root: under jsdom, import.meta.url is an http URL.
const xml = readFileSync(resolve(process.cwd(), 'public/demo-route.gpx'), 'utf8')
const route = Route.from(parseGpx(xml))

describe('bundled demo route', () => {
  it('parses with a name and elevation', () => {
    expect(route.name).toBe('Demo Climb')
    expect(route.hasElevation).toBe(true)
    expect(route.points.length).toBeGreaterThan(400)
  })

  it('is about twelve kilometres long', () => {
    expect(route.totalDistance).toBeGreaterThan(11_500)
    expect(route.totalDistance).toBeLessThan(12_500)
  })

  it('climbs roughly 450 m', () => {
    expect(route.totalAscent).toBeGreaterThan(400)
    expect(route.totalAscent).toBeLessThan(500)
  })

  it('has a rolling approach, a climb and a descent', () => {
    expect(route.gradientAt(1_000)).toBeGreaterThan(0)
    expect(route.gradientAt(1_000)).toBeLessThan(3)

    expect(route.gradientAt(5_000)).toBeGreaterThan(4)
    expect(route.gradientAt(5_000)).toBeLessThan(11)

    expect(route.gradientAt(10_000)).toBeLessThan(-3)
    expect(route.gradientAt(10_000)).toBeGreaterThan(-9)
  })

  it('keeps every gradient plausible', () => {
    for (const gradient of route.gradients) {
      expect(Math.abs(gradient)).toBeLessThanOrEqual(25)
    }
  })

  it('rises monotonically in distance', () => {
    for (let i = 1; i < route.points.length; i++) {
      expect(route.points[i]!.distance).toBeGreaterThan(route.points[i - 1]!.distance)
    }
  })
})
