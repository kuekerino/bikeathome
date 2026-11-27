/**
 * Routes through a region: from place to place along the roads, the short
 * way, never against a one-way street.
 *
 * Pure.
 */

import { metres } from './graph.ts'
import type { Place, Region, TrackPoint } from './region.ts'
import type { LatLon } from '../course/geo.ts'

export class PlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanError'
  }
}

/** Case and accents ignored: "soller" finds Sóller, "coll de soller" finds Coll de Sóller. */
export function normaliseName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** A place by name, or a "lat,lon" pair. Exact names beat names that merely start the same way. */
export function findStop(region: Region, query: string): LatLon & { label: string } {
  const pair = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query)
  if (pair) return { lat: Number(pair[1]), lon: Number(pair[2]), label: query.trim() }

  const wanted = normaliseName(query)
  const exact = region.places.filter((p) => normaliseName(p.name) === wanted)
  const start = exact.length > 0 ? exact : region.places.filter((p) => normaliseName(p.name).startsWith(wanted))
  // A town beats a hamlet of the same name.
  const order = ['town', 'village', 'suburb', 'pass', 'hamlet']
  const found = [...start].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  if (found.length === 0) throw new PlanError(`No place called "${query}" in ${region.name}.`)
  const best = found[0]!
  const rivals = found.filter((p) => p.kind === best.kind && normaliseName(p.name) !== normaliseName(best.name))
  if (exact.length === 0 && rivals.length > 0) {
    throw new PlanError(`"${query}" could be ${found.slice(0, 5).map(describe).join(', ')}. Say which.`)
  }
  return { lat: best.lat, lon: best.lon, label: best.name }
}

const describe = (p: Place) => `${p.name} (${p.kind})`

/** The junction nearest a point. */
export function nearestNode(region: Region, p: LatLon): number {
  let best = -1
  let bestD = Number.POSITIVE_INFINITY
  region.nodes.forEach((n, i) => {
    const d = metres(n, p)
    if (d < bestD) [best, bestD] = [i, d]
  })
  return best
}

export interface Leg {
  road: number
  /** Ridden from `a` to `b`. */
  forward: boolean
}

/** The shortest way from one junction to another, or null if the roads do not connect them. */
export function shortestPath(region: Region, from: number, to: number): Leg[] | null {
  const out = new Map<number, Leg[]>()
  region.roads.forEach((road, i) => {
    ;(out.get(road.a) ?? out.set(road.a, []).get(road.a)!).push({ road: i, forward: true })
    if (!road.oneway) (out.get(road.b) ?? out.set(road.b, []).get(road.b)!).push({ road: i, forward: false })
  })
  const dist = new Float64Array(region.nodes.length).fill(Number.POSITIVE_INFINITY)
  const via: (Leg | null)[] = new Array(region.nodes.length).fill(null)
  const heap = new MinHeap()
  dist[from] = 0
  heap.push(0, from)
  while (heap.size > 0) {
    const [d, node] = heap.pop()!
    if (d > dist[node]!) continue
    if (node === to) break
    for (const leg of out.get(node) ?? []) {
      const road = region.roads[leg.road]!
      const next = leg.forward ? road.b : road.a
      const nd = d + road.length
      if (nd < dist[next]!) {
        dist[next] = nd
        via[next] = leg
        heap.push(nd, next)
      }
    }
  }
  if (!Number.isFinite(dist[to]!)) return null
  const legs: Leg[] = []
  for (let node = to; node !== from; ) {
    const leg = via[node]!
    legs.push(leg)
    const road = region.roads[leg.road]!
    node = leg.forward ? road.a : road.b
  }
  return legs.reverse()
}

/** Places to points along the roads, joined end to end. A loop comes back to where it started. */
export function planRoute(region: Region, stops: readonly LatLon[], options: { loop?: boolean } = {}): { points: TrackPoint[]; legs: Leg[] } {
  if (stops.length < 2 && !options.loop) throw new PlanError('A route needs at least two places.')
  const nodes = stops.map((s) => nearestNode(region, s))
  if (options.loop) nodes.push(nodes[0]!)
  const legs: Leg[] = []
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i] === nodes[i - 1]) continue
    const path = shortestPath(region, nodes[i - 1]!, nodes[i]!)
    if (!path) throw new PlanError(`No way along the roads from stop ${i} to stop ${i + 1}.`)
    legs.push(...path)
  }
  if (legs.length === 0) throw new PlanError('Those places are at the same junction.')
  return { points: trackOf(region, legs), legs }
}

/** The points of a chain of roads, each in the direction it is ridden, without doubling the junctions. */
export function trackOf(region: Region, legs: readonly Leg[]): TrackPoint[] {
  const points: TrackPoint[] = []
  for (const leg of legs) {
    const track = region.roads[leg.road]!.track
    const ordered = leg.forward ? track : [...track].reverse()
    points.push(...(points.length === 0 ? ordered : ordered.slice(1)))
  }
  return points
}

export function toGpx(name: string, points: readonly TrackPoint[], credit: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const pts = points
    .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${escape(credit)} -->
<gpx version="1.1" creator="bikeathome route planner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escape(name)}</name></metadata>
  <trk><name>${escape(name)}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>
`
}

/** A binary heap of [priority, value], smallest priority first. */
class MinHeap {
  private readonly items: [number, number][] = []
  get size(): number {
    return this.items.length
  }
  push(priority: number, value: number): void {
    const items = this.items
    items.push([priority, value])
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent]![0] <= items[i]![0]) break
      ;[items[parent], items[i]] = [items[i]!, items[parent]!]
      i = parent
    }
  }
  pop(): [number, number] | undefined {
    const items = this.items
    if (items.length === 0) return undefined
    const top = items[0]!
    const last = items.pop()!
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < items.length && items[l]![0] < items[m]![0]) m = l
        if (r < items.length && items[r]![0] < items[m]![0]) m = r
        if (m === i) break
        ;[items[m], items[i]] = [items[i]!, items[m]!]
        i = m
      }
    }
    return top
  }
}
