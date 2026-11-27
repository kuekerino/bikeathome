/**
 * Builds a region: a rideable road network with LiDAR heights on every road.
 *
 *   npm run region -- islas-baleares-latest.osm.pbf --bbox 39.68,2.58,39.98,3.23 --name "Tramuntana" --out public/regions/tramuntana.json
 *
 * The input is an OpenStreetMap extract (.osm.pbf, from Geofabrik for
 * example) or an Overpass answer in JSON with way geometry. Heights come from
 * the same national terrain models as the course tool; the region must lie in
 * one of them. Runs on Node 22.18 or newer; behind an HTTPS proxy set
 * NODE_USE_ENV_PROXY=1.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { inflateSync } from 'node:zlib'

import { localFrame, type LatLon } from '../src/lib/course/geo.ts'
import { PROFILE_STEP_M, resample } from '../src/lib/course/profile.ts'
import { sourceFor } from '../src/lib/course/sources.ts'
import { buildGraph, DEFAULT_BUILD, lineLength, ROAD_RANK, type OsmWay } from '../src/lib/network/graph.ts'
import { readPbf } from '../src/lib/network/pbf.ts'
import { heightGraph, toFile, type Place } from '../src/lib/network/region.ts'
import { TileSet } from './tiles.ts'

interface Box {
  south: number
  west: number
  north: number
  east: number
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      bbox: { type: 'string' },
      name: { type: 'string', default: 'Region' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const input = positionals[0]
  if (values.help || !input || !values.bbox || !values.out) {
    console.log('Usage: npm run region -- <extract.osm.pbf | overpass.json> --bbox south,west,north,east --name <name> --out <file.json>')
    process.exit(values.help ? 0 : 1)
  }
  const [south, west, north, east] = values.bbox.split(',').map(Number)
  if (![south, west, north, east].every(Number.isFinite)) throw new Error(`--bbox needs four numbers, not "${values.bbox}".`)
  const box: Box = { south: south!, west: west!, north: north!, east: east! }
  const centre = { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 }
  const source = sourceFor(centre)
  if (!source) throw new Error('No terrain model covers that box yet: Spain (IGN) and England (Environment Agency) are supported.')

  // ---- roads and places
  const started = Date.now()
  const { ways, places } = input.endsWith('.pbf') ? await fromPbf(resolve(input), box) : await fromOverpass(resolve(input), box)
  console.log(`${values.name}: ${ways.length} road ways and ${places.length} places in the box (${secs(started)})`)

  const { graph, report } = buildGraph(ways, DEFAULT_BUILD)
  const km = (k: number) => (k / 1000).toFixed(0)
  const total = graph.edges.reduce((s, e) => s + lineLength(e.points), 0)
  const junctions = countJunctions(graph.edges, graph.nodes.length)
  console.log(
    `  network   ${graph.edges.length} roads, ${km(total)} km, ${junctions} junctions ` +
      `(${report.roundabouts} roundabouts collapsed, ${report.merged} tight junctions merged, ` +
      `${report.deadEndsDropped} short dead ends and ${report.componentsDropped} unconnected bits dropped)`,
  )
  const byClass = new Map<string, number>()
  for (const e of graph.edges) byClass.set(e.highway, (byClass.get(e.highway) ?? 0) + lineLength(e.points))
  console.log('  by class  ' + [...byClass].sort((a, b) => (ROAD_RANK[b[0]] ?? 0) - (ROAD_RANK[a[0]] ?? 0)).map(([c, m]) => `${c} ${km(m)} km`).join(', '))
  const structures = graph.edges.reduce((s, e) => s + e.structures.length, 0)
  console.log(`  mapped    ${structures} bridges and tunnels`)

  // ---- heights
  const frame = localFrame(centre)
  const tiles = new TileSet(source)
  for (const e of graph.edges) {
    for (const p of resample(e.points.map(frame.toLocal), PROFILE_STEP_M).points) {
      for (const [dx, dz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as const) {
        tiles.want(source.fineTile(...source.project(frame.toLatLon(p.x + dx, p.z + dz))))
      }
    }
  }
  console.log(`  heights   ${tiles.size} tiles of ${source.label}`)
  await tiles.load('roads')
  const height = (x: number, z: number) => {
    const [px, py] = source.project(frame.toLatLon(x, z))
    return tiles.sample(source.fineTile(px, py), px, py)
  }
  const heighted = heightGraph(graph, centre, height)
  const eles = heighted.nodes.map((n) => n.ele)
  console.log(
    `  heights   ${Math.round(Math.min(...eles))} to ${Math.round(Math.max(...eles))} m at junctions; ` +
      `${heighted.report.missing} samples without data; ${heighted.report.smoothed} unmapped jumps smoothed; ` +
      `ends moved at most ${heighted.report.worstJoin.toFixed(1)} m to meet at junctions`,
  )

  // ---- the file
  const credit = `Roads © OpenStreetMap contributors, ODbL 1.0. ${source.credit}`
  const file = toFile({ name: values.name!, credit, nodes: heighted.nodes, roads: heighted.roads, places })
  const out = resolve(values.out)
  await mkdir(dirname(out), { recursive: true })
  const text = JSON.stringify(file)
  await writeFile(out, text)
  console.log(`  wrote     ${out}, ${(text.length / 1e6).toFixed(1)} MB (${secs(started)})`)
  console.log(`  ${credit}`)
}

function countJunctions(edges: readonly { a: number; b: number }[], nodes: number): number {
  const degree = new Uint32Array(nodes)
  for (const e of edges) {
    degree[e.a]!++
    degree[e.b]!++
  }
  return degree.filter((d) => d >= 3).length
}

const inBox = (p: LatLon, b: Box) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east

const PLACE_KINDS = new Set(['town', 'village', 'hamlet', 'suburb'])

function placeOf(tags: Record<string, string>, at: LatLon): Place | null {
  const name = tags.name
  if (!name) return null
  if (PLACE_KINDS.has(tags.place ?? '')) return { name, kind: tags.place!, ...at }
  if (tags.mountain_pass === 'yes') return { name, kind: 'pass', ...at }
  return null
}

/** Ways that touch the box, whole, with their geometry. Two passes over the file: ways first, then only the nodes they need. */
async function fromPbf(path: string, box: Box): Promise<{ ways: OsmWay[]; places: Place[] }> {
  const file = new Uint8Array(await readFile(path))
  const inflate = (b: Uint8Array) => new Uint8Array(inflateSync(b))
  const kept: { id: number; refs: number[]; tags: Record<string, string> }[] = []
  readPbf(file, { way: (w) => DEFAULT_BUILD.classes.includes(w.tags.highway ?? '') && kept.push(w) }, inflate)
  const needed = new Set<number>()
  for (const w of kept) for (const r of w.refs) needed.add(r)
  const at = new Map<number, LatLon>()
  const places: Place[] = []
  readPbf(
    file,
    {
      node: (n) => {
        if (needed.has(n.id)) at.set(n.id, { lat: n.lat, lon: n.lon })
        if (inBox(n, box)) {
          const place = placeOf(n.tags, { lat: n.lat, lon: n.lon })
          if (place) places.push(place)
        }
      },
    },
    inflate,
  )
  const ways: OsmWay[] = []
  for (const w of kept) {
    const geometry = w.refs.map((r) => at.get(r))
    if (geometry.some((g) => !g)) continue // runs off the edge of the extract
    if (!geometry.some((g) => inBox(g!, box))) continue
    ways.push({ id: w.id, tags: w.tags, nodes: w.refs, geometry: geometry as LatLon[] })
  }
  return { ways, places }
}

async function fromOverpass(path: string, box: Box): Promise<{ ways: OsmWay[]; places: Place[] }> {
  const data = JSON.parse(await readFile(path, 'utf8')) as { elements: Record<string, unknown>[] }
  const ways: OsmWay[] = []
  const places: Place[] = []
  const seen = new Set<number>()
  for (const e of data.elements) {
    if (e.type === 'way' && Array.isArray(e.geometry) && Array.isArray(e.nodes) && !seen.has(e.id as number)) {
      seen.add(e.id as number)
      ways.push({ id: e.id as number, tags: (e.tags ?? {}) as Record<string, string>, nodes: e.nodes as number[], geometry: e.geometry as LatLon[] })
    } else if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      const place = placeOf((e.tags ?? {}) as Record<string, string>, { lat: e.lat, lon: e.lon as number })
      if (place && inBox(place, box)) places.push(place)
    }
  }
  return { ways: ways.filter((w) => w.geometry.some((g) => inBox(g, box))), places }
}

const secs = (since: number) => `${((Date.now() - since) / 1000).toFixed(0)} s`

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
