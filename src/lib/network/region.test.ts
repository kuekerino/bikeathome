import { describe, expect, it } from 'vitest'

import { readGpx } from '../course/gpx'
import { buildGraph, DEFAULT_BUILD, type OsmWay } from './graph'
import { findStop, planRoute, shortestPath, toGpx } from './plan'
import { decodeTrack, encodeTrack, fromFile, heightGraph, toFile, type Region } from './region'

const LAT0 = 39.82
const LON0 = 2.88
const point = (x: number, y: number) => ({ lat: LAT0 + y / 111195, lon: LON0 + x / (111195 * Math.cos((LAT0 * Math.PI) / 180)) })

describe('track encoding', () => {
  it('round-trips to a metre and a decimetre', () => {
    const track = [
      { lat: 39.82011, lon: 2.88022, ele: 512.34 },
      { lat: 39.81999, lon: 2.88101, ele: 498.06 },
      { lat: 39.9, lon: 3.1, ele: -1.2 },
    ]
    const back = decodeTrack(encodeTrack(track))
    back.forEach((p, k) => {
      expect(p.lat).toBeCloseTo(track[k]!.lat, 5)
      expect(p.lon).toBeCloseTo(track[k]!.lon, 5)
      expect(Math.abs(p.ele - track[k]!.ele)).toBeLessThanOrEqual(0.05)
    })
  })
})

// A triangle of roads, A at the origin, B 2 km east, C 1 km north of the middle,
// on a slope rising 2 m per 100 m towards the east. A to B is one-way eastbound.
function triangle(): Region {
  const at: Record<number, [number, number]> = { 1: [0, 0], 2: [2000, 0], 3: [1000, 1000] }
  const way = (id: number, nodes: number[], tags: Record<string, string> = {}): OsmWay => ({
    id,
    tags: { highway: 'secondary', ...tags },
    nodes,
    geometry: nodes.map((n) => point(...at[n]!)),
  })
  const { graph } = buildGraph([way(1, [1, 2], { oneway: 'yes', name: 'Carrer Major' }), way(2, [2, 3]), way(3, [3, 1])], {
    ...DEFAULT_BUILD,
    deadEndM: 0,
    minorDeadEndM: 0,
  })
  const ground = (x: number) => 100 + x * 0.02
  const { nodes, roads } = heightGraph(graph, { lat: LAT0, lon: LON0 }, (x) => ground(x))
  return {
    name: 'Test',
    credit: 'test data',
    nodes,
    roads,
    places: [
      { name: 'Sóller', kind: 'town', ...point(0, 0) },
      { name: 'Coll de Sóller', kind: 'pass', ...point(1000, 1000) },
      { name: 'Fornalutx', kind: 'village', ...point(2000, 0) },
    ],
  }
}

describe('heightGraph', () => {
  it('follows the ground, and meets every junction at one height', () => {
    const region = triangle()
    for (const road of region.roads) {
      expect(road.track[0]!.ele).toBeCloseTo(region.nodes[road.a]!.ele, 6)
      expect(road.track[road.track.length - 1]!.ele).toBeCloseTo(region.nodes[road.b]!.ele, 6)
      // 10 m apart
      expect(road.track.length).toBeGreaterThan(road.length / 10 - 1)
    }
    const east = region.nodes.find((n) => n.lon > LON0 + 0.02)!
    expect(east.ele).toBeCloseTo(140, 0)
  })
})

describe('planRoute', () => {
  it('finds places by name, ignoring accents and case', () => {
    const region = triangle()
    expect(findStop(region, 'soller').label).toBe('Sóller')
    expect(findStop(region, 'COLL DE SOLLER').label).toBe('Coll de Sóller')
    expect(findStop(region, '39.83,2.9')).toMatchObject({ lat: 39.83, lon: 2.9 })
    expect(() => findStop(region, 'Valldemossa')).toThrow(/No place/)
  })

  it('takes the one-way road only the way it goes', () => {
    const region = triangle()
    const from = (name: string) => region.nodes.findIndex((n) => Math.abs(n.lat - findStop(region, name).lat) < 1e-4 && Math.abs(n.lon - findStop(region, name).lon) < 1e-4)
    const a = from('Sóller')
    const b = from('Fornalutx')
    const length = (legs: ReturnType<typeof shortestPath>) => legs!.reduce((sum, leg) => sum + region.roads[leg.road]!.length, 0)
    // The pass is no junction (only two roads meet there), so the way round is one road of about 2.8 km.
    expect(length(shortestPath(region, a, b))).toBeCloseTo(2000, -1) // straight along the one-way street
    expect(length(shortestPath(region, b, a))).toBeCloseTo(2828, -1) // round by the pass
  })

  it('joins roads into one track, turned the way they are ridden, as a GPX the app reads', () => {
    const region = triangle()
    const stops = ['Fornalutx', 'Sóller'].map((n) => findStop(region, n))
    const { points } = planRoute(region, stops)
    expect(points[0]!.lon).toBeGreaterThan(points[points.length - 1]!.lon)
    for (let k = 1; k < points.length; k++) {
      // no doubled junctions, no jumps
      const step = Math.hypot((points[k]!.lat - points[k - 1]!.lat) * 111195, (points[k]!.lon - points[k - 1]!.lon) * 85500)
      expect(step).toBeGreaterThan(1)
      expect(step).toBeLessThan(12)
    }
    const gpx = readGpx(toGpx('Fornalutx to Sóller', points, 'test'))
    expect(gpx.name).toBe('Fornalutx to Sóller')
    expect(gpx.points).toHaveLength(points.length)
    expect(gpx.elevations[0]).toBeCloseTo(140, 0)
  })

  it('comes back to the start on a loop', () => {
    const region = triangle()
    const { points } = planRoute(region, [findStop(region, 'Sóller'), findStop(region, 'Fornalutx')], { loop: true })
    expect(points[0]!.lat).toBeCloseTo(points[points.length - 1]!.lat, 6)
    expect(points[0]!.lon).toBeCloseTo(points[points.length - 1]!.lon, 6)
  })
})

describe('region file', () => {
  it('round-trips, and refuses what is not one', () => {
    const region = triangle()
    const back = fromFile(JSON.parse(JSON.stringify(toFile(region))))
    expect(back.roads).toHaveLength(region.roads.length)
    expect(back.roads[0]!.track[5]!.ele).toBeCloseTo(region.roads[0]!.track[5]!.ele, 1)
    expect(back.places[0]!.name).toBe('Sóller')
    expect(() => fromFile({ format: 'something else' })).toThrow(/not a region/)
    expect(() => fromFile({ ...toFile(region), version: 2 })).toThrow(/version 2/)
  })
})
