/**
 * Elevation rasters: reading the formats the two LiDAR services send, and
 * looking heights up in them.
 *
 * Pure. A grid knows its position in whatever coordinates its service uses
 * (degrees for Spain, National Grid metres for England); converting a point
 * into those coordinates is the caller's job.
 */

/**
 * A north-up raster. `data[row * cols + col]`, row 0 along the top edge.
 * Values belong to cell centres; NaN marks no data.
 */
export interface Grid {
  cols: number
  rows: number
  /** Coordinate of the left edge of the first column. */
  left: number
  /** Coordinate of the top edge of the first row. */
  top: number
  /** Cell width and height, both positive. */
  dx: number
  dy: number
  data: Float32Array
}

/**
 * Heights outside this band are no-data markers or survey artefacts, not
 * ground: the services use huge negative floats and -9999 for "nothing here".
 */
const PLAUSIBLE_M = { min: -500, max: 9000 } as const

export function plausible(value: number): number {
  return value > PLAUSIBLE_M.min && value < PLAUSIBLE_M.max ? value : Number.NaN
}

/**
 * Bilinear height between the four nearest cell centres. NaN outside the grid
 * or when any of the four has no data, so a hole is never smeared into its
 * neighbours. Within half a cell of the edge the outermost centres are used.
 */
export function sampleGrid(grid: Grid, x: number, y: number): number {
  const fx = (x - grid.left) / grid.dx - 0.5
  const fy = (grid.top - y) / grid.dy - 0.5
  if (fx < -0.5 || fy < -0.5 || fx > grid.cols - 0.5 || fy > grid.rows - 0.5) return Number.NaN

  const c0 = Math.max(0, Math.min(grid.cols - 2, Math.floor(fx)))
  const r0 = Math.max(0, Math.min(grid.rows - 2, Math.floor(fy)))
  const u = Math.max(0, Math.min(1, fx - c0))
  const v = Math.max(0, Math.min(1, fy - r0))
  const d = grid.data
  const w = grid.cols
  const corners: [value: number, weight: number][] = [
    [d[r0 * w + c0]!, (1 - u) * (1 - v)],
    [d[r0 * w + c0 + 1]!, u * (1 - v)],
    [d[(r0 + 1) * w + c0]!, (1 - u) * v],
    [d[(r0 + 1) * w + c0 + 1]!, u * v],
  ]
  let sum = 0
  for (const [value, weight] of corners) {
    if (weight === 0) continue // exactly on a centre or an edge: a hole beside it does not matter
    if (Number.isNaN(value)) return Number.NaN
    sum += value * weight
  }
  return sum
}

export class GridFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GridFormatError'
  }
}

/**
 * Esri ASCII grid, as the Spanish service returns it when asked for
 * `application/asc`. Its TIFF output is rounded to whole metres, which would
 * put a percentage point of noise on every 100 m of gradient; the text keeps
 * the millimetres. The response arrives wrapped in a MIME multipart envelope,
 * so everything before the `ncols` header is skipped.
 */
export function parseAsciiGrid(text: string): Grid {
  const start = text.search(/^\s*ncols\b/im)
  if (start < 0) throw new GridFormatError(`Not an ASCII grid: ${text.slice(0, 200).replace(/\s+/g, ' ')}`)

  const tokens = text.slice(start).split(/\s+/).filter((token) => token !== '')
  const header = new Map<string, number>()
  let i = 0
  while (i + 1 < tokens.length && /^[a-z_]+$/i.test(tokens[i]!)) {
    header.set(tokens[i]!.toLowerCase(), Number(tokens[i + 1]))
    i += 2
  }

  const cols = header.get('ncols')
  const rows = header.get('nrows')
  const cell = header.get('cellsize')
  const dx = header.get('dx') ?? cell
  const dy = header.get('dy') ?? cell
  if (!cols || !rows || !dx || !dy) throw new GridFormatError('ASCII grid header is incomplete.')

  const xCorner = header.get('xllcorner')
  const yCorner = header.get('yllcorner')
  const xCentre = header.get('xllcenter')
  const yCentre = header.get('yllcenter')
  const left = xCorner ?? (xCentre !== undefined ? xCentre - dx / 2 : Number.NaN)
  const bottom = yCorner ?? (yCentre !== undefined ? yCentre - dy / 2 : Number.NaN)
  if (!Number.isFinite(left) || !Number.isFinite(bottom)) {
    throw new GridFormatError('ASCII grid has no lower-left position.')
  }

  const noData = header.get('nodata_value')
  const data = new Float32Array(cols * rows)
  for (let k = 0; k < data.length; k++) {
    const token = tokens[i + k]
    if (token === undefined) throw new GridFormatError(`ASCII grid ends after ${k} of ${data.length} values.`)
    const value = Number(token)
    data[k] = value === noData ? Number.NaN : plausible(value)
  }

  return { cols, rows, left, top: bottom + rows * dy, dx, dy, data }
}
