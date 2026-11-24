import { describe, expect, it } from 'vitest'

import { ea, ign, sourceFor } from './sources.ts'

const mallorca = { lat: 39.7397, lon: 2.6948 }
const cheltenham = { lat: 51.8826, lon: -2.079 }

describe('sourceFor', () => {
  it('picks the service that covers the route', () => {
    expect(sourceFor(mallorca)).toBe(ign)
    expect(sourceFor(cheltenham)).toBe(ea)
    expect(sourceFor({ lat: 52.52, lon: 13.4 })).toBeNull() // Berlin: neither
  })

  it('rides on the side of the road the country drives on', () => {
    expect(ign.drive).toBe('right')
    expect(ea.drive).toBe('left')
  })
})

/** The four bounds in a GetCoverage URL. */
function bounds(url: string): { south: number; north: number; west: number; east: number } {
  const lat = /Lat\(([-\d.]+),([-\d.]+)\)/.exec(url)!
  const lon = /Long\(([-\d.]+),([-\d.]+)\)/.exec(url)!
  return { south: Number(lat[1]), north: Number(lat[2]), west: Number(lon[1]), east: Number(lon[2]) }
}

describe('ign tiles', () => {
  const [lon, lat] = ign.project(mallorca)

  it('asks for a window on the native grid, so the cells come back unresampled', () => {
    const tile = ign.fineTile(lon, lat)
    const b = bounds(tile.url)
    const onGrid = (v: number) => Math.abs(v / 0.000045 - Math.round(v / 0.000045)) < 1e-6
    expect(onGrid(b.west + 18.21)).toBe(true)
    expect(onGrid(43.93 - b.north)).toBe(true)
    expect(b.east - b.west).toBeCloseTo(240 * 0.000045, 9)
    expect(b.north - b.south).toBeCloseTo(240 * 0.000045, 9)
    expect(b.west).toBeLessThanOrEqual(lon)
    expect(b.east).toBeGreaterThan(lon)
    expect(b.south).toBeLessThanOrEqual(lat)
    expect(b.north).toBeGreaterThan(lat)
    expect(tile.url).toContain('format=application/asc')
    expect(tile.url).not.toContain('scalesize')
  })

  it('gives the same tile to nearby points', () => {
    expect(ign.fineTile(lon, lat).key).toBe(ign.fineTile(lon + 0.000001, lat - 0.000001).key)
  })

  it('reuses the fine tiles for 10 m terrain and asks for coarser ones beyond', () => {
    expect(ign.coarseTile(lon, lat, 10).key).toBe(ign.fineTile(lon, lat).key)
    const coarse = ign.coarseTile(lon, lat, 30)
    expect(coarse.url).toContain('scalesize=long(240),lat(240)')
    const b = bounds(coarse.url)
    expect(b.east - b.west).toBeCloseTo(3 * 240 * 0.000045, 9)
  })
})

describe('ea tiles', () => {
  const [e, n] = ea.project(cheltenham)

  it('asks for 250 m squares at 2 m for the road', () => {
    const tile = ea.fineTile(e, n)
    const east = /E\((\d+),(\d+)\)/.exec(tile.url)!
    const north = /N\((\d+),(\d+)\)/.exec(tile.url)!
    expect(Number(east[1]) % 250).toBe(0)
    expect(Number(east[2]) - Number(east[1])).toBe(250)
    expect(Number(north[1]) % 250).toBe(0)
    expect(Number(east[1])).toBeLessThanOrEqual(e)
    expect(Number(north[1])).toBeLessThanOrEqual(n)
    expect(tile.url).toContain('scalefactor=0.5')
  })

  it('asks for 1 km squares at 5 m for 10 m terrain', () => {
    const tile = ea.coarseTile(e, n, 10)
    expect(tile.url).toContain('scalefactor=0.2')
    const east = /E\((\d+),(\d+)\)/.exec(tile.url)!
    expect(Number(east[2]) - Number(east[1])).toBe(1000)
  })
})
