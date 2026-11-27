/**
 * A region: a rideable road network with heights on every road, in one file
 * the app can load and the tools can plan routes through.
 *
 * Pure. Roads © OpenStreetMap contributors (ODbL); heights from the national
 * terrain model of wherever the region is.
 */

import { localFrame, type LatLon, type Local } from '../course/geo.ts'
import { buildProfile, PROFILE_STEP_M, resample } from '../course/profile.ts'
import type { Graph } from './graph.ts'
import { lineLength } from './graph.ts'

export interface TrackPoint extends LatLon {
  ele: number
}

export interface Road {
  a: number
  b: number
  /** Metres. */
  length: number
  rank: number
  highway: string
  name: string | null
  ref: string | null
  oneway: boolean
  /** Every 10 m from `a` to `b`, both ends included, with heights. */
  track: TrackPoint[]
}

export interface Place extends LatLon {
  name: string
  /** town, village, hamlet, suburb, or pass. */
  kind: string
}

export interface Region {
  name: string
  credit: string
  nodes: TrackPoint[]
  roads: Road[]
  places: Place[]
}

/** Spacing of the stored tracks. The app smooths gradient over 100 m, so 10 m loses nothing it uses. */
export const TRACK_STEP_M = 10

// ------------------------------------------------------------------ heights

export interface HeightsReport {
  /** Stretches straightened as unmapped bridges or embankments. */
  smoothed: number
  /** Samples where the terrain model had nothing. */
  missing: number
  /** Largest correction made to bring a road's ends to its junctions' heights, metres. */
  worstJoin: number
}

/**
 * Heights for every road. Each road gets its profile as a GPX route does,
 * with mapped bridges and tunnels laid straight; then every junction takes
 * the mean of the ends that meet there, and each road is tilted linearly to
 * meet those heights, so there is no step anywhere a rider can turn.
 */
export function heightGraph(
  graph: Graph,
  centre: LatLon,
  height: (x: number, z: number) => number,
): { nodes: TrackPoint[]; roads: Road[]; report: HeightsReport } {
  const frame = localFrame(centre)
  const report: HeightsReport = { smoothed: 0, missing: 0, worstJoin: 0 }

  const profiles = graph.edges.map((edge) => {
    const local: Local[] = edge.points.map(frame.toLocal)
    const resampled = resample(local, PROFILE_STEP_M)
    const profile = buildProfile(resampled, height, PROFILE_STEP_M, edge.structures)
    report.smoothed += profile.bridged.length
    report.missing += profile.missing
    return { resampled, heights: profile.heights }
  })

  // One height per junction: the mean of the road ends that meet there.
  const sum = new Float64Array(graph.nodes.length)
  const count = new Uint32Array(graph.nodes.length)
  graph.edges.forEach((edge, k) => {
    const h = profiles[k]!.heights
    sum[edge.a] += h[0]!
    count[edge.a]!++
    sum[edge.b] += h[h.length - 1]!
    count[edge.b]!++
  })
  const nodeEle = Array.from(sum, (s, i) => s / Math.max(1, count[i]!))

  const roads: Road[] = graph.edges.map((edge, k) => {
    const { resampled, heights } = profiles[k]!
    const total = resampled.distance[resampled.distance.length - 1] || 1
    const startFix = nodeEle[edge.a]! - heights[0]!
    const endFix = nodeEle[edge.b]! - heights[heights.length - 1]!
    report.worstJoin = Math.max(report.worstJoin, Math.abs(startFix), Math.abs(endFix))
    const track: TrackPoint[] = []
    const every = Math.round(TRACK_STEP_M / PROFILE_STEP_M)
    resampled.points.forEach((p, i) => {
      if (i % every !== 0 && i !== resampled.points.length - 1) return
      const f = resampled.distance[i]! / total
      track.push({ ...frame.toLatLon(p.x, p.z), ele: heights[i]! + startFix * (1 - f) + endFix * f })
    })
    return {
      a: edge.a,
      b: edge.b,
      length: lineLength(edge.points),
      rank: edge.rank,
      highway: edge.highway,
      name: edge.name,
      ref: edge.ref,
      oneway: edge.oneway,
      track,
    }
  })

  const nodes = graph.nodes.map((p, i) => ({ ...p, ele: nodeEle[i]! }))
  return { nodes, roads, report }
}

// ------------------------------------------------------------------ storage

/**
 * Points as text: each value as the change from the one before, scaled to an
 * integer, written in Google's polyline alphabet. Latitude and longitude to
 * the metre, height to the decimetre: a region of a thousand kilometres of
 * road fits in about a megabyte.
 */
export function encodeTrack(points: readonly TrackPoint[]): string {
  const scales = [1e5, 1e5, 10]
  const previous = [0, 0, 0]
  let out = ''
  for (const p of points) {
    const values = [p.lat, p.lon, p.ele]
    values.forEach((v, d) => {
      const scaled = Math.round(v * scales[d]!)
      out += encodeSigned(scaled - previous[d]!)
      previous[d] = scaled
    })
  }
  return out
}

export function decodeTrack(text: string): TrackPoint[] {
  const scales = [1e5, 1e5, 10]
  const values = [0, 0, 0]
  const out: TrackPoint[] = []
  let i = 0
  let d = 0
  while (i < text.length) {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = text.charCodeAt(i++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && i < text.length)
    values[d] = values[d]! + (result & 1 ? ~(result >> 1) : result >> 1)
    d++
    if (d === 3) {
      out.push({ lat: values[0]! / scales[0]!, lon: values[1]! / scales[1]!, ele: values[2]! / scales[2]! })
      d = 0
    }
  }
  return out
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

/** The file: compact, versioned, and readable without the app. */
export interface RegionFile {
  format: 'bikeathome-region'
  version: 1
  name: string
  credit: string
  nodes: [lat: number, lon: number, ele: number][]
  roads: { a: number; b: number; length: number; rank: number; highway: string; name: string | null; ref: string | null; oneway: boolean; track: string }[]
  places: { name: string; kind: string; lat: number; lon: number }[]
}

export function toFile(region: Region): RegionFile {
  const r = (v: number, k: number) => Math.round(v * k) / k
  return {
    format: 'bikeathome-region',
    version: 1,
    name: region.name,
    credit: region.credit,
    nodes: region.nodes.map((n) => [r(n.lat, 1e6), r(n.lon, 1e6), r(n.ele, 10)]),
    roads: region.roads.map((road) => ({
      a: road.a,
      b: road.b,
      length: r(road.length, 10),
      rank: road.rank,
      highway: road.highway,
      name: road.name,
      ref: road.ref,
      oneway: road.oneway,
      track: encodeTrack(road.track),
    })),
    places: region.places.map((p) => ({ name: p.name, kind: p.kind, lat: r(p.lat, 1e6), lon: r(p.lon, 1e6) })),
  }
}

export class RegionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegionError'
  }
}

/** Reads a region file back, checking what a planner would otherwise trip over deep inside. */
export function fromFile(file: unknown): Region {
  const f = file as Partial<RegionFile>
  if (f?.format !== 'bikeathome-region') throw new RegionError('This is not a region file.')
  if (f.version !== 1) throw new RegionError(`Region file version ${String(f.version)} is not one this app reads.`)
  if (!Array.isArray(f.nodes) || !Array.isArray(f.roads)) throw new RegionError('The region file has no roads.')
  const nodes = f.nodes.map(([lat, lon, ele]) => ({ lat, lon, ele }))
  const roads = f.roads.map((road, k) => {
    if (!(road.a >= 0 && road.a < nodes.length && road.b >= 0 && road.b < nodes.length)) {
      throw new RegionError(`Road ${k} joins junctions the region does not have.`)
    }
    const track = decodeTrack(road.track)
    if (track.length < 2) throw new RegionError(`Road ${k} has no track.`)
    return { ...road, track }
  })
  return { name: f.name ?? 'Region', credit: f.credit ?? '', nodes, roads, places: f.places ?? [] }
}
