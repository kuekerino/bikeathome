/**
 * A road network for riding: OpenStreetMap ways turned into junctions and the
 * roads between them, simplified until every junction is one a rider would
 * call a junction.
 *
 * Pure. Relative imports carry their `.ts` extension so the tools can run
 * this under plain Node.
 *
 * Road data © OpenStreetMap contributors, ODbL.
 */

import { EARTH_RADIUS_M, type LatLon } from '../course/geo.ts'

export interface OsmWay {
  id: number
  tags: Record<string, string>
  /** Node ids, one per point of `geometry`. */
  nodes: number[]
  geometry: LatLon[]
}

/** How major a road is: decides which way "straight on" goes, and which dead ends are worth keeping. */
export const ROAD_RANK: Readonly<Record<string, number>> = {
  trunk: 6,
  trunk_link: 6,
  primary: 5,
  primary_link: 5,
  secondary: 4,
  secondary_link: 4,
  tertiary: 3,
  tertiary_link: 3,
  unclassified: 2,
  cycleway: 2,
  residential: 1,
  living_street: 1,
}

export interface BuildOptions {
  /** Road classes to keep. */
  classes: readonly string[]
  /** Junctions closer than this along a connecting road are one junction: slip lanes, islands, splayed corners. */
  mergeM: number
  /** Dead ends shorter than this are dropped: a cul-de-sac is not a choice. */
  deadEndM: number
  /** Minor dead ends (unclassified and below) shorter than this are dropped too. */
  minorDeadEndM: number
}

export const DEFAULT_BUILD: BuildOptions = {
  classes: ['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'cycleway'],
  mergeM: 25,
  deadEndM: 400,
  minorDeadEndM: 1500,
}

export interface Edge {
  a: number
  b: number
  points: LatLon[]
  /** Highest rank of the roads joined into this one. */
  rank: number
  highway: string
  name: string | null
  ref: string | null
  /** Rideable only from `a` to `b`. */
  oneway: boolean
  /** Stretches on bridges or in tunnels, metres from `a`. */
  structures: { from: number; to: number }[]
  /** OpenStreetMap ways it is made of. */
  ways: number[]
}

export interface Graph {
  nodes: LatLon[]
  edges: Edge[]
}

export interface BuildReport {
  ways: number
  rawEdges: number
  roundabouts: number
  merged: number
  deadEndsDropped: number
  componentsDropped: number
  nodes: number
  edges: number
}

// ------------------------------------------------------------------ geometry

export function metres(a: LatLon, b: LatLon): number {
  const k = (Math.PI / 180) * EARTH_RADIUS_M
  const dx = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  const dy = (b.lat - a.lat) * k
  return Math.hypot(dx, dy)
}

export function lineLength(points: readonly LatLon[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += metres(points[i - 1]!, points[i]!)
  return total
}

// ------------------------------------------------------------------ tags

/** Whether a bicycle may use the way at all. */
export function rideable(tags: Record<string, string>, classes: readonly string[]): boolean {
  if (!classes.includes(tags.highway ?? '')) return false
  if (tags.area === 'yes') return false
  if (tags.bicycle === 'no' || tags.bicycle === 'dismount') return false
  if ((tags.access === 'no' || tags.access === 'private') && tags.bicycle !== 'yes' && tags.bicycle !== 'designated') return false
  return true
}

/** 1: only forwards, -1: only backwards, 0: both ways, for a bicycle. */
export function onewayForBikes(tags: Record<string, string>): 1 | -1 | 0 {
  if (tags['oneway:bicycle'] === 'no' || tags.cycleway === 'opposite' || tags.cycleway === 'opposite_lane') return 0
  const oneway = tags['oneway:bicycle'] ?? tags.oneway
  if (oneway === 'yes' || oneway === '1' || oneway === 'true') return 1
  if (oneway === '-1' || oneway === 'reverse') return -1
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1
  return 0
}

const isStructure = (tags: Record<string, string>) =>
  (tags.bridge !== undefined && tags.bridge !== 'no') || (tags.tunnel !== undefined && tags.tunnel !== 'no')

// ------------------------------------------------------------------ building

class UnionFind {
  private readonly parent = new Map<number, number>()
  find(x: number): number {
    let root = x
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!
    let node = x
    while (node !== root) {
      const next = this.parent.get(node) ?? root
      this.parent.set(node, root)
      node = next
    }
    return root
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

interface RawEdge {
  a: number // OSM node ids until the end
  b: number
  points: LatLon[]
  rank: number
  highway: string
  name: string | null
  ref: string | null
  oneway: boolean
  structures: { from: number; to: number }[]
  ways: number[]
  roundabout: boolean
}

/**
 * OpenStreetMap ways to a rideable graph:
 *
 * 1. keep the rideable ways of the chosen classes;
 * 2. split them at every node shared between ways, and at their ends;
 * 3. collapse each roundabout to one junction;
 * 4. merge junctions joined by a connecting road shorter than `mergeM`;
 * 5. drop short dead ends, repeatedly, so a cul-de-sac off a cul-de-sac goes too;
 * 6. keep the largest connected part;
 * 7. join roads that meet only each other, so every node left is a real choice.
 */
export function buildGraph(input: readonly OsmWay[], options: BuildOptions = DEFAULT_BUILD): { graph: Graph; report: BuildReport } {
  const ways = input.filter((w) => w.nodes.length >= 2 && w.nodes.length === w.geometry.length && rideable(w.tags, options.classes))
  const position = new Map<number, LatLon>()
  const uses = new Map<number, number>()
  for (const w of ways) {
    w.nodes.forEach((id, i) => {
      position.set(id, w.geometry[i]!)
      uses.set(id, (uses.get(id) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1))
    })
  }
  // A node splits ways where more than one way passes, or where a way ends.
  const isJunction = (id: number) => (uses.get(id) ?? 0) >= 2

  // ---- 2. split
  let edges: RawEdge[] = []
  for (const w of ways) {
    const dir = onewayForBikes(w.tags)
    const nodes = dir === -1 ? [...w.nodes].reverse() : w.nodes
    const geometry = dir === -1 ? [...w.geometry].reverse() : w.geometry
    const structure = isStructure(w.tags)
    let start = 0
    for (let i = 1; i < nodes.length; i++) {
      if (i < nodes.length - 1 && !isJunction(nodes[i]!)) continue
      const points = geometry.slice(start, i + 1)
      const length = lineLength(points)
      edges.push({
        a: nodes[start]!,
        b: nodes[i]!,
        points,
        rank: ROAD_RANK[w.tags.highway ?? ''] ?? 0,
        highway: w.tags.highway ?? '',
        name: w.tags.name ?? null,
        ref: w.tags.ref ?? null,
        oneway: dir !== 0,
        structures: structure ? [{ from: 0, to: length }] : [],
        ways: [w.id],
        roundabout: w.tags.junction === 'roundabout' || w.tags.junction === 'circular',
      })
      start = i
    }
  }
  const rawEdges = edges.length

  // ---- 3 + 4. one junction per roundabout, and per tight cluster
  const uf = new UnionFind()
  let roundabouts = 0
  const roundaboutWays = new Set<number>()
  for (const e of edges) {
    if (!e.roundabout) continue
    uf.union(e.a, e.b)
    roundaboutWays.add(e.ways[0]!)
  }
  roundabouts = roundaboutWays.size
  // Only real junctions merge: three or more roads at both ends. A short piece
  // between two ordinary points is just road, mapped as a way of its own, and
  // often a bridge: the 13 m bridge at Sa Calobra's knot is one.
  const junctionDegree = new Map<number, number>()
  for (const e of edges) {
    if (e.roundabout) continue
    for (const id of [uf.find(e.a), uf.find(e.b)]) junctionDegree.set(id, (junctionDegree.get(id) ?? 0) + 1)
  }
  const isRealJunction = (id: number) => (junctionDegree.get(uf.find(id)) ?? 0) >= 3
  let merged = 0
  for (const e of edges) {
    if (e.roundabout || e.a === e.b) continue
    if (lineLength(e.points) < options.mergeM && uf.find(e.a) !== uf.find(e.b) && isRealJunction(e.a) && isRealJunction(e.b)) {
      uf.union(e.a, e.b)
      merged++
    }
  }
  // Each merged junction sits at the middle of the junctions it was made from.
  const members = new Map<number, LatLon[]>()
  for (const e of edges) {
    for (const id of [e.a, e.b]) {
      const root = uf.find(id)
      if (root === id && !members.has(root)) members.set(root, [])
      const list = members.get(root) ?? members.set(root, []).get(root)!
      if (!list.includes(position.get(id)!)) list.push(position.get(id)!)
    }
  }
  const centre = new Map<number, LatLon>()
  for (const [root, list] of members) {
    centre.set(root, {
      lat: list.reduce((s, p) => s + p.lat, 0) / list.length,
      lon: list.reduce((s, p) => s + p.lon, 0) / list.length,
    })
  }
  edges = edges
    .filter((e) => !e.roundabout)
    .map((e) => {
      const a = uf.find(e.a)
      const b = uf.find(e.b)
      const points = [...e.points]
      if (a !== e.a) points[0] = centre.get(a)!
      if (b !== e.b) points[points.length - 1] = centre.get(b)!
      return { ...e, a, b, points }
    })
    .filter((e) => !(e.a === e.b && lineLength(e.points) < 2 * options.mergeM))

  // ---- 5. dead ends
  let deadEndsDropped = 0
  for (;;) {
    const degree = degrees(edges)
    const before = edges.length
    edges = edges.filter((e) => {
      const dangling = (degree.get(e.a) ?? 0) === 1 || (degree.get(e.b) ?? 0) === 1
      if (!dangling || e.a === e.b) return true
      const length = lineLength(e.points)
      const limit = e.rank <= ROAD_RANK.unclassified! ? options.minorDeadEndM : options.deadEndM
      return length >= limit
    })
    deadEndsDropped += before - edges.length
    if (edges.length === before) break
  }

  // ---- 6. largest connected part
  const parts = new UnionFind()
  for (const e of edges) parts.union(e.a, e.b)
  const size = new Map<number, number>()
  for (const e of edges) {
    const r = parts.find(e.a)
    size.set(r, (size.get(r) ?? 0) + lineLength(e.points))
  }
  let biggest = -1
  let most = -1
  for (const [r, s] of size) if (s > most) [biggest, most] = [r, s]
  const componentsDropped = size.size - (size.size > 0 ? 1 : 0)
  edges = edges.filter((e) => parts.find(e.a) === biggest)

  // ---- 7. join through roads
  edges = joinThroughRoads(edges)

  // ---- number the nodes
  const index = new Map<number, number>()
  const nodes: LatLon[] = []
  const at = (id: number, p: LatLon) => {
    if (!index.has(id)) {
      index.set(id, nodes.length)
      nodes.push(p)
    }
    return index.get(id)!
  }
  const out: Edge[] = edges.map((e) => ({
    a: at(e.a, e.points[0]!),
    b: at(e.b, e.points[e.points.length - 1]!),
    points: e.points,
    rank: e.rank,
    highway: e.highway,
    name: e.name,
    ref: e.ref,
    oneway: e.oneway,
    structures: e.structures,
    ways: e.ways,
  }))

  return {
    graph: { nodes, edges: out },
    report: { ways: ways.length, rawEdges, roundabouts, merged, deadEndsDropped, componentsDropped, nodes: nodes.length, edges: out.length },
  }
}

function degrees(edges: readonly { a: number; b: number }[]): Map<number, number> {
  const degree = new Map<number, number>()
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1)
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1)
  }
  return degree
}

/** Joins pairs of roads meeting at a node no other road touches, into one. */
function joinThroughRoads(input: RawEdge[]): RawEdge[] {
  const edges = new Set(input)
  const at = new Map<number, Set<RawEdge>>()
  const touch = (id: number, e: RawEdge) => (at.get(id) ?? at.set(id, new Set()).get(id)!).add(e)
  const untouch = (id: number, e: RawEdge) => at.get(id)?.delete(e)
  for (const e of edges) {
    touch(e.a, e)
    touch(e.b, e)
  }
  const queue = [...at.keys()]
  while (queue.length > 0) {
    const node = queue.pop()!
    const here = at.get(node)
    if (!here || here.size !== 2) continue
    const [x, y] = [...here] as [RawEdge, RawEdge]
    if (x === y || x.a === x.b || y.a === y.b) continue
    // Two-way joined to one-way would make the whole thing one-way: leave those apart.
    if (x.oneway !== y.oneway) continue
    // One road must arrive at the node and the other leave it; a one-way road cannot be turned round.
    const orient = (p: RawEdge, q: RawEdge): [RawEdge, RawEdge] | null => {
      const into = p.b === node ? p : reverse(p)
      const out = q.a === node ? q : reverse(q)
      return into && out ? [into, out] : null
    }
    const pair = orient(x, y) ?? orient(y, x)
    if (!pair) continue // two one-way roads both arriving, or both leaving: a real junction
    const [first, second] = pair
    const offset = lineLength(first.points)
    const joined: RawEdge = {
      a: first.a,
      b: second.b,
      points: [...first.points, ...second.points.slice(1)],
      rank: Math.max(first.rank, second.rank),
      highway: lineLength(first.points) >= lineLength(second.points) ? first.highway : second.highway,
      name: pickName(first, second),
      ref: first.ref ?? second.ref,
      oneway: first.oneway || second.oneway,
      structures: [...first.structures, ...second.structures.map((s) => ({ from: s.from + offset, to: s.to + offset }))],
      ways: [...first.ways, ...second.ways],
      roundabout: false,
    }
    for (const e of [x, y]) {
      edges.delete(e)
      untouch(e.a, e)
      untouch(e.b, e)
    }
    edges.add(joined)
    touch(joined.a, joined)
    touch(joined.b, joined)
    at.delete(node)
    queue.push(joined.a, joined.b)
  }
  return [...edges]
}

/** The same road the other way round, or null if it may only be ridden one way. */
function reverse(e: RawEdge): RawEdge | null {
  if (e.oneway) return null
  const length = lineLength(e.points)
  return {
    ...e,
    a: e.b,
    b: e.a,
    points: [...e.points].reverse(),
    structures: e.structures.map((s) => ({ from: length - s.to, to: length - s.from })).reverse(),
    ways: [...e.ways].reverse(),
  }
}

function pickName(x: RawEdge, y: RawEdge): string | null {
  // A bridge's or a tunnel's own name (Pont de Turixant, Túnel de Monnàber) is not the road's.
  const own = (e: RawEdge) => (wholly(e) ? null : e.name)
  const nx = own(x)
  const ny = own(y)
  if (!nx) return ny
  if (!ny) return nx
  return lineLength(x.points) >= lineLength(y.points) ? nx : ny
}

/** The whole piece is a bridge or a tunnel. */
function wholly(e: RawEdge): boolean {
  const length = lineLength(e.points)
  return e.structures.some((s) => s.from <= 0.5 && s.to >= length - 0.5)
}
