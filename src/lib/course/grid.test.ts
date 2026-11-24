import { describe, expect, it } from 'vitest'

import { parseAsciiGrid, sampleGrid, type Grid } from './grid.ts'
import { parseTiff } from './tiff.ts'

// The shape the Spanish service sends: a MIME envelope around the grid, then the projection.
const ascii = `
--wcs
Content-Type: application/asc
Content-ID: coverage/out.asc

ncols        3
nrows        2
xllcorner    2.000000000000
yllcorner    39.000000000000
cellsize     0.500000000000
NODATA_value -9999
 10.5 11.5 12.5
 20.5 -9999 22.5
--wcs
Content-Type: text/plain
Content-ID: coverage/out.prj

GEOGCS["GCS_WGS_1984"]
--wcs--
`

describe('parseAsciiGrid', () => {
  it('reads through the envelope, with row 0 at the top', () => {
    const grid = parseAsciiGrid(ascii)
    expect(grid).toMatchObject({ cols: 3, rows: 2, left: 2, top: 40, dx: 0.5, dy: 0.5 })
    expect(grid.data[0]).toBe(10.5)
    expect(grid.data[3]).toBe(20.5)
    expect(grid.data[4]).toBeNaN()
  })

  it('refuses a service error', () => {
    expect(() => parseAsciiGrid('<ows:ExceptionReport>bad request</ows:ExceptionReport>')).toThrow(/Not an ASCII grid/)
  })

  it('refuses a short grid', () => {
    expect(() => parseAsciiGrid('ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2 3')).toThrow(/ends after 3/)
  })
})

describe('sampleGrid', () => {
  // Heights rise 1 m per unit east and 10 m per unit south.
  const grid: Grid = {
    cols: 3,
    rows: 3,
    left: 0,
    top: 3,
    dx: 1,
    dy: 1,
    data: Float32Array.from([0, 1, 2, 10, 11, 12, 20, 21, 22]),
  }

  it('is exact at cell centres and linear between them', () => {
    expect(sampleGrid(grid, 0.5, 2.5)).toBeCloseTo(0)
    expect(sampleGrid(grid, 1.5, 1.5)).toBeCloseTo(11)
    expect(sampleGrid(grid, 1.0, 2.0)).toBeCloseTo(5.5)
  })

  it('holds the edge value in the outer half cell and refuses beyond it', () => {
    expect(sampleGrid(grid, 0.1, 2.9)).toBeCloseTo(0)
    expect(sampleGrid(grid, -0.1, 1.5)).toBeNaN()
    expect(sampleGrid(grid, 1.5, 3.1)).toBeNaN()
  })

  it('refuses to blend across a hole', () => {
    const holed = { ...grid, data: Float32Array.from([0, 1, 2, 10, Number.NaN, 12, 20, 21, 22]) }
    expect(sampleGrid(holed, 1.0, 2.0)).toBeNaN()
    expect(sampleGrid(holed, 0.5, 2.5)).toBeCloseTo(0)
  })
})

/** A minimal little-endian TIFF: one strip, float32 samples. */
function floatTiff(cols: number, rows: number, values: number[]): Uint8Array {
  const entries: [number, number, number, number][] = [
    [256, 3, 1, cols],
    [257, 3, 1, rows],
    [258, 3, 1, 32],
    [259, 3, 1, 1],
    [273, 4, 1, 0], // patched below
    [277, 3, 1, 1],
    [278, 3, 1, rows],
    [339, 3, 1, 3],
  ]
  const ifd = 8
  const dataStart = ifd + 2 + entries.length * 12 + 4
  const bytes = new Uint8Array(dataStart + values.length * 4)
  const view = new DataView(bytes.buffer)
  bytes.set([0x49, 0x49])
  view.setUint16(2, 42, true)
  view.setUint32(4, ifd, true)
  view.setUint16(ifd, entries.length, true)
  entries.forEach(([tag, type, count, value], i) => {
    const at = ifd + 2 + i * 12
    view.setUint16(at, tag, true)
    view.setUint16(at + 2, type, true)
    view.setUint32(at + 4, count, true)
    if (tag === 273) view.setUint32(at + 8, dataStart, true)
    else if (type === 3) view.setUint16(at + 8, value, true)
    else view.setUint32(at + 8, value, true)
  })
  values.forEach((v, i) => view.setFloat32(dataStart + i * 4, v, true))
  return bytes
}

describe('parseTiff', () => {
  it('reads float samples and drops the no-data marker', () => {
    const raster = parseTiff(floatTiff(2, 2, [81.25, 82.5, -3.4e38, 84]))
    expect(raster.cols).toBe(2)
    expect(raster.rows).toBe(2)
    expect(raster.data[0]).toBeCloseTo(81.25)
    expect(raster.data[1]).toBeCloseTo(82.5)
    expect(raster.data[2]).toBeNaN()
    expect(raster.data[3]).toBeCloseTo(84)
  })

  it('refuses a service error page', () => {
    expect(() => parseTiff(new TextEncoder().encode('<?xml version="1.0"?><ExceptionReport/>'))).toThrow(/Not a TIFF/)
  })
})
