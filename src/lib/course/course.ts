/**
 * A course in the shape golden-hour-ride's renderer loads: a road line with
 * heights, and a square height grid around it, quantised to 16 bits.
 *
 * Pure. The renderer only requires `size`, `cells`, `demMin`, `demMax`,
 * `dem`, `road` and `credit`; the rest describes the course for whatever
 * draws it next (which side of the road to ride on, whether the ends meet).
 */

import type { LatLon, Local } from './geo.ts'

/**
 * golden-hour-ride builds one terrain mesh of (cells + 1)² vertices and
 * walks a shadow ray from each. Its Leckhampton course is 620 cells a side;
 * this keeps any course near that, by widening the cells on a big one.
 */
export const MAX_TERRAIN_CELLS = 640
/** Terrain beyond the road in every direction, so there are hills on the horizon. */
export const TERRAIN_MARGIN_M = 1300
const MIN_CELL_M = 10
/** One road control point every 15 m, as in golden-hour-ride. */
const ROAD_EVERY = 3
/** Ends closer than this make a loop. */
const LOOP_GAP_M = 60
/** Searched for a neighbour when the terrain has a hole. */
const HOLE_RADIUS_CELLS = 3
/**
 * Where the terrain model has nothing across a wide area, it is almost
 * always the sea. Set a little below sea level, so water drawn at zero
 * covers it cleanly.
 */
export const SEA_FLOOR_M = -2

export interface TerrainPlan {
  /** Side of the square, metres, centred on the local origin. */
  size: number
  cells: number
  cell: number
}

export function planTerrain(points: readonly Local[], margin = TERRAIN_MARGIN_M): TerrainPlan {
  let reach = 0
  for (const p of points) reach = Math.max(reach, Math.abs(p.x), Math.abs(p.z))
  const wanted = Math.ceil((2 * (reach + margin)) / 200) * 200
  const cell = Math.max(MIN_CELL_M, Math.ceil(wanted / MAX_TERRAIN_CELLS / 5) * 5)
  const cells = Math.ceil(wanted / cell)
  return { size: cells * cell, cells, cell }
}

/** Every vertex of the grid, row 0 along the north edge, as golden-hour-ride reads it. */
export function terrainVertices(plan: TerrainPlan): Local[] {
  const out: Local[] = []
  for (let iz = 0; iz <= plan.cells; iz++) {
    for (let ix = 0; ix <= plan.cells; ix++) {
      out.push({ x: -plan.size / 2 + ix * plan.cell, z: -plan.size / 2 + iz * plan.cell })
    }
  }
  return out
}

/**
 * Patches holes: a small one takes the mean of what is around it, a large
 * one is taken to be sea.
 */
export function fillTerrain(heights: Float32Array, width: number): { holes: number; sea: number } {
  const source = heights.slice()
  let holes = 0
  let sea = 0
  for (let k = 0; k < heights.length; k++) {
    if (!Number.isNaN(source[k]!)) continue
    const row = Math.floor(k / width)
    const col = k % width
    let sum = 0
    let n = 0
    for (let dr = -HOLE_RADIUS_CELLS; dr <= HOLE_RADIUS_CELLS; dr++) {
      for (let dc = -HOLE_RADIUS_CELLS; dc <= HOLE_RADIUS_CELLS; dc++) {
        const r = row + dr
        const c = col + dc
        if (r < 0 || c < 0 || r >= width || c >= width) continue
        const v = source[r * width + c]!
        if (!Number.isNaN(v)) {
          sum += v
          n++
        }
      }
    }
    if (n > 0) {
      heights[k] = sum / n
      holes++
    } else {
      heights[k] = SEA_FLOOR_M
      sea++
    }
  }
  return { holes, sea }
}

export interface Dem {
  demMin: number
  demMax: number
  /** Little-endian unsigned 16-bit values, base64. */
  dem: string
}

/** 16 bits across the course's height range: a 1,500 m mountain resolves to 2.3 cm. */
export function encodeDem(heights: Float32Array): Dem {
  let demMin = Number.POSITIVE_INFINITY
  let demMax = Number.NEGATIVE_INFINITY
  for (const h of heights) {
    demMin = Math.min(demMin, h)
    demMax = Math.max(demMax, h)
  }
  if (demMax === demMin) demMax = demMin + 1
  const bytes = new Uint8Array(heights.length * 2)
  const view = new DataView(bytes.buffer)
  heights.forEach((h, k) => view.setUint16(k * 2, Math.round(((h - demMin) / (demMax - demMin)) * 65535), true))
  return { demMin, demMax, dem: toBase64(bytes) }
}

export function decodeDem(dem: Dem): Float32Array {
  const bytes = Uint8Array.from(atob(dem.dem), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const out = new Float32Array(bytes.length / 2)
  for (let k = 0; k < out.length; k++) out[k] = dem.demMin + (view.getUint16(k * 2, true) / 65535) * (dem.demMax - dem.demMin)
  return out
}

export interface Course extends Dem {
  name: string
  size: number
  cells: number
  /** Road control points: [metres east, height, metres south]. */
  road: [number, number, number][]
  credit: string
  /** The ends meet, so the ride can go round again. */
  loop: boolean
  region: 'spain' | 'england'
  drive: 'left' | 'right'
  /** Latitude and longitude of the local origin. */
  centre: LatLon
  /** Length of the road, metres. */
  length: number
}

/** Ends that meet on a route much longer than the gap between them. */
export function isLoop(points: readonly Local[]): boolean {
  const a = points[0]
  const b = points[points.length - 1]
  if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) >= LOOP_GAP_M) return false
  let length = 0
  for (let k = 1; k < points.length; k++) length += Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.z - points[k - 1]!.z)
  return length > 10 * LOOP_GAP_M
}

/**
 * Road control points from the resampled line and its heights. A loop drops
 * its last point, which the renderer's closed curve would otherwise double;
 * an open road keeps its end.
 */
export function roadLine(points: readonly Local[], heights: readonly number[], loop: boolean): [number, number, number][] {
  const out: [number, number, number][] = []
  const round = (v: number) => Math.round(v * 100) / 100
  for (let k = 0; k < points.length - 1; k += ROAD_EVERY) out.push([round(points[k]!.x), round(heights[k]!), round(points[k]!.z)])
  if (!loop) {
    const k = points.length - 1
    out.push([round(points[k]!.x), round(heights[k]!), round(points[k]!.z)])
  }
  return out
}

/** The file golden-hour-ride loads with a `<script>` tag. */
export function courseScript(id: string, course: Course): string {
  return (
    'window.RIDE_COURSES = window.RIDE_COURSES || {};\n' +
    `window.RIDE_COURSES[${JSON.stringify(id)}] = ${JSON.stringify(course)};\n`
  )
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let k = 0; k < bytes.length; k += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000))
  }
  return btoa(binary)
}
