/**
 * Elevation tiles for the tools: fetched from the source's service, cached on
 * disk, held in memory for a run, and looked up by point.
 *
 * Shared by the course tool and the region tool. The cache is compressed: a
 * region needs hundreds of tiles, and the Spanish service sends each as
 * nearly half a megabyte of text, which shrinks to a quarter.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

import { sampleGrid, type Grid } from '../src/lib/course/grid.ts'
import type { ElevationSource, Tile } from '../src/lib/course/sources.ts'

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

/** Fetches, caches and holds the tiles a run needs, then answers height lookups from them. */
export class TileSet {
  private readonly wanted = new Map<string, Tile>()
  private readonly grids = new Map<string, Grid | null>()
  private readonly source: ElevationSource

  constructor(source: ElevationSource) {
    this.source = source
  }

  want(tile: Tile): void {
    this.wanted.set(tile.key, tile)
  }

  get size(): number {
    return this.wanted.size
  }

  async load(what: string): Promise<void> {
    const queue = [...this.wanted.values()].filter((tile) => !this.grids.has(tile.key))
    const total = queue.length
    let done = 0
    const report = () => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${what}: ${done} of ${total} tiles`)
      else if (done % 100 === 0 && done > 0) console.log(`  ${what}: ${done} of ${total} tiles`)
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
  for (const [path, unpack] of [
    [`${file}.gz`, (b: Uint8Array) => new Uint8Array(gunzipSync(b))],
    [file, (b: Uint8Array) => b], // cached before compression
  ] as const) {
    try {
      return tile.read(unpack(new Uint8Array(await readFile(path))))
    } catch {
      // not cached that way, or damaged: try the next, then fetch
    }
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
      await writeFile(`${file}.gz`, gzipSync(body))
      return grid
    } catch (error) {
      lastError = error
    }
  }
  console.warn(`\n  ${tile.key}: gave up after ${ATTEMPTS} attempts (${String(lastError)}), treated as no data`)
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}
