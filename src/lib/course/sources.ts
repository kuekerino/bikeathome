/**
 * Where the heights come from, and how each service cuts its data into tiles.
 *
 * Pure: this only says which tiles to ask for and how to read the answer.
 * Fetching, caching and retrying belong to the tool.
 *
 * Both services were checked by hand before this was written: they answer
 * with CORS open, so a browser could ask them too, and the Spanish one
 * declares "CC BY 4.0 scne.es" with no fees.
 */

import { wgs84ToBng, type LatLon } from './geo.ts'
import { parseAsciiGrid, type Grid } from './grid.ts'
import { parseTiff } from './tiff.ts'

export interface Tile {
  /** Stable name, also the cache file name. */
  key: string
  url: string
  read(body: Uint8Array): Grid
}

export interface ElevationSource {
  id: 'ign' | 'ea'
  /** Human name of the data, for the summary. */
  label: string
  /** Attribution the licence asks for. */
  credit: string
  region: 'spain' | 'england'
  drive: 'left' | 'right'
  /** A quick bounding-box test. Inside it the service may still have holes, such as the sea. */
  covers(p: LatLon): boolean
  /** Into the service's own coordinates, in which its tiles are laid out. */
  project(p: LatLon): [number, number]
  /** The full-resolution tile holding a projected point: for the road. */
  fineTile(x: number, y: number): Tile
  /** A tile at roughly `cellM / 2` metres resolution: for the terrain around the road. */
  coarseTile(x: number, y: number, cellM: number): Tile
}

// --- Spain: Instituto Geográfico Nacional --------------------------------

/**
 * The national terrain model on a 5 m grid, from the PNOA LiDAR flights,
 * served in ETRS89 geographic coordinates. ETRS89 and WGS84 differ by well
 * under a metre in Spain, so GPX positions are used as they are.
 */
const IGN_WCS = 'https://servicios.idee.es/wcs-inspire/mdt'
const IGN_COVERAGE = 'Elevacion4258_5'

/**
 * The coverage's native grid: cells of 0.000045 degrees whose edges fall on
 * -18.21 + k·cell east and 43.93 − k·cell south. A request aligned to those
 * edges returns the original cells; an unaligned one comes back resampled.
 */
const IGN_CELL_DEG = 0.000045
const IGN_WEST = -18.21
const IGN_NORTH = 43.93
/** 240 cells: about 1.2 km by 0.9 km in Mallorca, and some 460 KB of text. */
const IGN_TILE_CELLS = 240

export const ign: ElevationSource = {
  id: 'ign',
  label: 'IGN terrain model (5 m), Spain',
  credit: 'Heights: Modelo Digital del Terreno © Instituto Geográfico Nacional, CC BY 4.0 scne.es.',
  region: 'spain',
  drive: 'right',
  covers: (p) => p.lat > 27.63 && p.lat < 43.93 && p.lon > -18.21 && p.lon < 4.94,
  project: (p) => [p.lon, p.lat],
  fineTile: (lon, lat) => ignTile(lon, lat, 1),
  // Native 5 m cells are already as fine as a 10 m terrain grid wants.
  coarseTile: (lon, lat, cellM) => ignTile(lon, lat, Math.max(1, Math.floor(cellM / 10))),
}

/** A tile of 240 output cells a side, each `factor` native cells wide. */
function ignTile(lon: number, lat: number, factor: number): Tile {
  const span = IGN_TILE_CELLS * factor * IGN_CELL_DEG
  const i = Math.floor((lon - IGN_WEST) / span)
  const j = Math.floor((IGN_NORTH - lat) / span)
  const west = IGN_WEST + i * span
  const north = IGN_NORTH - j * span
  const params = [
    'service=WCS',
    'version=2.0.1',
    'request=GetCoverage',
    `coverageId=${IGN_COVERAGE}`,
    `subset=Lat(${(north - span).toFixed(6)},${north.toFixed(6)})`,
    `subset=Long(${west.toFixed(6)},${(west + span).toFixed(6)})`,
    'format=application/asc',
  ]
  // An explicit output size, not a scale factor: 1/3 would round to 239 cells.
  if (factor > 1) params.push(`scalesize=long(${IGN_TILE_CELLS}),lat(${IGN_TILE_CELLS})`)
  return {
    key: `ign-${factor}x-${i}-${j}`,
    url: `${IGN_WCS}?${params.join('&')}`,
    read: (body) => parseAsciiGrid(new TextDecoder().decode(body)),
  }
}

// --- England: Environment Agency -------------------------------------------

/**
 * The LiDAR Composite DTM at 1 m, served on the British National Grid.
 * Same service and same windows as golden-hour-ride's Leckhampton course:
 * 250 m squares at 2 m for the road, larger and coarser ones for terrain.
 */
const EA_WCS = 'https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wcs'
const EA_COVERAGE = '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'

export const ea: ElevationSource = {
  id: 'ea',
  label: 'Environment Agency LiDAR (1 m), England',
  credit: 'Heights: Environment Agency LiDAR Composite DTM, Open Government Licence v3.0.',
  region: 'england',
  drive: 'left',
  covers: (p) => p.lat > 49.8 && p.lat < 55.9 && p.lon > -6.5 && p.lon < 1.9,
  project: (p) => wgs84ToBng(p.lat, p.lon),
  fineTile: (e, n) => eaTile(e, n, 250, 2),
  coarseTile: (e, n, cellM) => {
    const resolution = Math.max(2, Math.round(cellM / 2))
    return eaTile(e, n, resolution * 200, resolution)
  },
}

function eaTile(e: number, n: number, size: number, resolution: number): Tile {
  const i = Math.floor(e / size)
  const j = Math.floor(n / size)
  const west = i * size
  const south = j * size
  const url =
    `${EA_WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${EA_COVERAGE}` +
    `&subset=E(${west},${west + size})&subset=N(${south},${south + size})` +
    `&format=image/tiff&scalefactor=${1 / resolution}`
  return {
    key: `ea-${size}m-${resolution}m-${i}-${j}`,
    url,
    read: (body) => {
      const raster = parseTiff(body)
      return {
        ...raster,
        left: west,
        top: south + size,
        dx: size / raster.cols,
        dy: size / raster.rows,
      }
    },
  }
}

export const SOURCES: readonly ElevationSource[] = [ign, ea]

/** The source whose area holds the route's centre, or null if neither does. */
export function sourceFor(centre: LatLon): ElevationSource | null {
  return SOURCES.find((source) => source.covers(centre)) ?? null
}
