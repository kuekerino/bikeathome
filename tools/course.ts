/**
 * Turns a GPX into a course with real road heights.
 *
 *   npm run course -- my-ride.gpx
 *
 * Writes, next to the GPX:
 *
 *   my-ride.lidar.gpx   the same file with every <ele> taken from LiDAR,
 *                       ready to load in the app
 *   my-ride.course.js   the road and the terrain around it, in the format
 *                       golden-hour-ride's 3D renderer loads
 *
 * Heights come from Spain's national terrain model (IGN) or England's
 * Environment Agency LiDAR, picked by where the route is. Both are fetched in
 * tiles and cached under .cache/course, so a second run is offline.
 *
 * Runs on Node 22.18 or newer, which executes TypeScript as it is. Behind an
 * HTTPS proxy, set NODE_USE_ENV_PROXY=1 so Node's fetch uses it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
  courseScript,
  encodeDem,
  fillTerrain,
  isLoop,
  planTerrain,
  roadLine,
  terrainVertices,
  TERRAIN_MARGIN_M,
  type Course,
} from '../src/lib/course/course.ts'
import { localFrame, type LatLon } from '../src/lib/course/geo.ts'
import { readGpx, writeElevations } from '../src/lib/course/gpx.ts'
import { sampleGrid, type Grid } from '../src/lib/course/grid.ts'
import { buildProfile, cumulative, heightsAt, PROFILE_STEP_M, resample } from '../src/lib/course/profile.ts'
import { ea, ign, sourceFor, type ElevationSource, type Tile } from '../src/lib/course/sources.ts'

const CACHE_DIR = resolve(import.meta.dirname, '..', '.cache', 'course')
const PARALLEL = 2
/**
 * The Environment Agency's server sometimes holds a request open without
 * answering, and the same request sent again goes straight through. So:
 * a short wait per try, and plenty of tries. A tile is at most half a
 * megabyte, which never needs thirty seconds.
 */
const ATTEMPTS = 10
const TIMEOUT_MS = 30_000
const MAX_BACKOFF_MS = 15_000

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      margin: { type: 'string' },
      out: { type: 'string' },
      'no-terrain': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const input = positionals[0]
  if (values.help || !input) {
    console.log(
      [
        'Usage: npm run course -- <route.gpx> [options]',
        '',
        '  --source ign|ea   force a data source (default: picked by location)',
        `  --margin <m>      terrain beyond the road on every side (default ${TERRAIN_MARGIN_M})`,
        '  --out <dir>       where to write (default: next to the GPX)',
        '  --no-terrain      only write the GPX with new heights',
      ].join('\n'),
    )
    process.exit(input ? 0 : 1)
  }

  const path = resolve(input)
  const xml = await readFile(path, 'utf8')
  const track = readGpx(xml)
  const centre = boundsCentre(track.points)
  const source = pickSource(values.source, centre)
  const outside = track.points.filter((p) => !source.covers(p)).length
  console.log(`${track.name ?? basename(path)}: ${track.points.length} points, heights from ${source.label}`)
  if (outside > 0) console.warn(`  ${outside} points lie outside the area this source covers; expect gaps there.`)

  // --- the road -------------------------------------------------------------
  const frame = localFrame(centre)
  const local = track.points.map(frame.toLocal)
  const resampled = resample(local)
  const tiles = new TileSet(source)
  const reach = 10 // metres either side of the line that the road search can probe
  for (const p of resampled.points) {
    for (const [dx, dz] of [[-reach, -reach], [reach, -reach], [-reach, reach], [reach, reach]] as const) {
      tiles.want(source.fineTile(...source.project(frame.toLatLon(p.x + dx, p.z + dz))))
    }
  }
  await tiles.load('road')
  const profile = buildProfile(resampled, (x, z) => {
    const [px, py] = source.project(frame.toLatLon(x, z))
    return tiles.sample(source.fineTile(px, py), px, py)
  })
  const elevations = heightsAt({ distance: resampled.distance, heights: profile.heights }, cumulative(local))

  const base = basename(path).replace(/\.gpx$/i, '')
  const outDir = values.out ? resolve(values.out) : dirname(path)
  await mkdir(outDir, { recursive: true })
  const gpxOut = join(outDir, `${base}.lidar.gpx`)
  await writeFile(gpxOut, withProvenance(writeElevations(xml, track.kind, elevations), source))

  // --- the terrain ----------------------------------------------------------
  let courseOut: string | null = null
  let terrainNote = ''
  if (!values['no-terrain']) {
    const margin = values.margin === undefined ? TERRAIN_MARGIN_M : Number(values.margin)
    if (!Number.isFinite(margin) || margin < 0) throw new Error(`--margin must be a number of metres, not "${values.margin}".`)
    const plan = planTerrain(resampled.points, margin)
    const vertices = terrainVertices(plan)
    const projected = vertices.map((v) => source.project(frame.toLatLon(v.x, v.z)))
    const coarse = new TileSet(source)
    for (const [px, py] of projected) coarse.want(source.coarseTile(px, py, plan.cell))
    await coarse.load('terrain')
    const heights = Float32Array.from(projected, ([px, py]) => coarse.sample(source.coarseTile(px, py, plan.cell), px, py))
    const filled = fillTerrain(heights, plan.cells + 1)

    const loop = isLoop(resampled.points)
    const course: Course = {
      name: track.name ?? base,
      size: plan.size,
      cells: plan.cells,
      ...encodeDem(heights),
      road: roadLine(resampled.points, profile.heights, loop),
      credit: source.credit,
      loop,
      region: source.region,
      drive: source.drive,
      centre: { lat: round(centre.lat, 6), lon: round(centre.lon, 6) },
      length: round(resampled.distance[resampled.distance.length - 1] ?? 0, 1),
    }
    courseOut = join(outDir, `${base}.course.js`)
    await writeFile(courseOut, courseScript(slug(base), course))
    terrainNote =
      `  terrain   ${(plan.size / 1000).toFixed(1)} km square, ${plan.cell} m cells` +
      (filled.holes ? `, ${filled.holes} small holes filled` : '') +
      (filled.sea ? `, ${filled.sea} cells with no data treated as sea` : '') +
      `\n  loop      ${loop ? 'yes, the ends meet' : 'no, it runs from A to B'}`
  }

  // --- what happened ----------------------------------------------------------
  const length = resampled.distance[resampled.distance.length - 1] ?? 0
  const gps = track.elevations.filter((e): e is number => e !== null)
  const lines = [
    '',
    `  distance  ${(length / 1000).toFixed(2)} km`,
    `  climbing  ${Math.round(climb(profile.heights))} m from LiDAR` +
      (gps.length > 1 ? `, the GPX itself said ${Math.round(climb(gps))} m` : ''),
    `  steepest  ${steepest(profile.heights)}, over 100 m`,
  ]
  if (profile.missing > 0) {
    lines.push(`  gaps      ${profile.missing} of ${profile.heights.length} road samples had no data and took a neighbour's height`)
  }
  for (const span of profile.bridged) {
    lines.push(
      `  bridged   ${(span.from / 1000).toFixed(2)} to ${(span.to / 1000).toFixed(2)} km straightened ` +
        '(a bridge or tunnel the terrain model leaves out; worth a look)',
    )
  }
  if (terrainNote) lines.push(terrainNote)
  lines.push('', `  wrote     ${gpxOut}`)
  if (courseOut) lines.push(`            ${courseOut}`)
  lines.push('', `  ${source.credit}`)
  console.log(lines.join('\n'))
}

/** Fetches, caches and holds the tiles a run needs, then answers height lookups from them. */
class TileSet {
  private readonly wanted = new Map<string, Tile>()
  private readonly grids = new Map<string, Grid | null>()
  private readonly source: ElevationSource

  constructor(source: ElevationSource) {
    this.source = source
  }

  want(tile: Tile): void {
    this.wanted.set(tile.key, tile)
  }

  async load(what: string): Promise<void> {
    const queue = [...this.wanted.values()].filter((tile) => !this.grids.has(tile.key))
    const total = queue.length
    let done = 0
    const report = () => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${what}: ${done} of ${total} tiles`)
    }
    report()
    const worker = async () => {
      for (let tile = queue.shift(); tile; tile = queue.shift()) {
        this.grids.set(tile.key, await fetchGrid(tile, this.source))
        done++
        report()
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
    if (process.stdout.isTTY) process.stdout.write('\r')
    const empty = [...this.grids.values()].filter((g) => g === null).length
    console.log(`  ${what}: ${total} tiles${empty ? `, ${empty} without data` : ''}`)
  }

  sample(tile: Tile, x: number, y: number): number {
    const grid = this.grids.get(tile.key)
    return grid ? sampleGrid(grid, x, y) : Number.NaN
  }
}

/** A tile from the cache, or from the service with retries; null if the service has nothing readable. */
async function fetchGrid(tile: Tile, source: ElevationSource): Promise<Grid | null> {
  const file = join(CACHE_DIR, source.id, tile.key)
  try {
    return tile.read(new Uint8Array(await readFile(file)))
  } catch {
    // not cached yet, or a damaged file: fetch it again
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1)))
    try {
      const response = await fetch(tile.url, {
        headers: { 'User-Agent': 'bikeathome-course-tool' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`)
      if (!response.ok) {
        console.warn(`\n  ${tile.key}: HTTP ${response.status}, treated as no data`)
        return null
      }
      const body = new Uint8Array(await response.arrayBuffer())
      const grid = tile.read(body)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, body)
      return grid
    } catch (error) {
      lastError = error
    }
  }
  console.warn(`\n  ${tile.key}: gave up after ${ATTEMPTS} attempts (${String(lastError)}), treated as no data`)
  return null
}

function pickSource(forced: string | undefined, centre: LatLon): ElevationSource {
  if (forced === 'ign') return ign
  if (forced === 'ea') return ea
  if (forced !== undefined) throw new Error(`Unknown --source "${forced}". Use ign (Spain) or ea (England).`)
  const found = sourceFor(centre)
  if (!found) {
    throw new Error(
      `No LiDAR source for ${centre.lat.toFixed(4)}, ${centre.lon.toFixed(4)} yet. ` +
        'Spain (IGN) and England (Environment Agency) are supported.',
    )
  }
  return found
}

function boundsCentre(points: readonly LatLon[]): LatLon {
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  }
}

/** A comment under the XML declaration saying where the heights came from. */
function withProvenance(xml: string, source: ElevationSource): string {
  const note = `<!-- Elevations from ${source.label}, set by bikeathome's course tool. ${source.credit} -->`
  const declaration = /^\s*<\?xml[^>]*\?>/.exec(xml)
  return declaration ? `${declaration[0]}\n${note}${xml.slice(declaration[0].length)}` : `${note}\n${xml}`
}

function climb(heights: readonly number[]): number {
  let total = 0
  for (let k = 1; k < heights.length; k++) total += Math.max(0, heights[k]! - heights[k - 1]!)
  return total
}

function steepest(heights: readonly number[]): string {
  const run = Math.round(100 / PROFILE_STEP_M)
  let up = 0
  let down = 0
  for (let k = 0; k + run < heights.length; k++) {
    const grade = ((heights[k + run]! - heights[k]!) / (run * PROFILE_STEP_M)) * 100
    up = Math.max(up, grade)
    down = Math.min(down, grade)
  }
  return `${up.toFixed(1)}% up, ${Math.abs(down).toFixed(1)}% down`
}

function slug(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'course'
}

function round(value: number, places: number): number {
  const k = 10 ** places
  return Math.round(value * k) / k
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
