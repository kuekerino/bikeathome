import { describe, expect, it } from 'vitest'

import { GpxError, readGpx, writeElevations } from './gpx.ts'

const track = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Coll &amp; back</name></metadata>
  <trk><name>Track name</name><trkseg>
    <trkpt lat="39.70" lon="2.70"><ele>10.5</ele><time>2026-01-01T10:00:00Z</time></trkpt>
    <trkpt lat='39.71' lon='2.71'><time>2026-01-01T10:00:01Z</time></trkpt>
    <trkpt lat="39.72" lon="2.72"/>
  </trkseg></trk>
</gpx>`

describe('readGpx', () => {
  it('reads track points, their elevations and the metadata name', () => {
    const gpx = readGpx(track)
    expect(gpx.kind).toBe('trkpt')
    expect(gpx.name).toBe('Coll & back')
    expect(gpx.points).toEqual([
      { lat: 39.7, lon: 2.7 },
      { lat: 39.71, lon: 2.71 },
      { lat: 39.72, lon: 2.72 },
    ])
    expect(gpx.elevations).toEqual([10.5, null, null])
  })

  it('falls back to route points, as the app does', () => {
    const route = '<gpx><rte><rtept lat="1" lon="2"/><rtept lat="3" lon="4"></rtept></rte></gpx>'
    const gpx = readGpx(route)
    expect(gpx.kind).toBe('rtept')
    expect(gpx.points).toHaveLength(2)
  })

  it('reads prefixed elements', () => {
    const gpx = readGpx('<g:gpx xmlns:g="x"><g:trk><g:trkseg><g:trkpt lat="1" lon="2"><g:ele>5</g:ele></g:trkpt></g:trkseg></g:trk></g:gpx>')
    expect(gpx.points).toEqual([{ lat: 1, lon: 2 }])
    expect(gpx.elevations).toEqual([5])
  })

  it('refuses what is not a usable GPX', () => {
    expect(() => readGpx('<kml/>')).toThrow(GpxError)
    expect(() => readGpx('<gpx></gpx>')).toThrow(/no track or route points/)
    expect(() => readGpx('<gpx><trkpt lat="x" lon="2"/></gpx>')).toThrow(/valid lat\/lon/)
  })
})

describe('writeElevations', () => {
  it('replaces, inserts, and expands self-closing points, touching nothing else', () => {
    const out = writeElevations(track, 'trkpt', [100, 200.123, 300])
    expect(out).toContain('<trkpt lat="39.70" lon="2.70"><ele>100.00</ele><time>2026-01-01T10:00:00Z</time></trkpt>')
    expect(out).toContain("<trkpt lat='39.71' lon='2.71'><ele>200.12</ele><time>2026-01-01T10:00:01Z</time></trkpt>")
    expect(out).toContain('<trkpt lat="39.72" lon="2.72"><ele>300.00</ele></trkpt>')
    expect(out.replace(/<ele>[^<]*<\/ele>/g, '')).toBe(track.replace(/<ele>[^<]*<\/ele>/g, '').replace('lon="2.72"/>', 'lon="2.72"></trkpt>'))
  })

  it('keeps a namespace prefix on the new element', () => {
    const out = writeElevations('<g:gpx><g:trkpt lat="1" lon="2"/></g:gpx>', 'trkpt', [7])
    expect(out).toBe('<g:gpx><g:trkpt lat="1" lon="2"><g:ele>7.00</g:ele></g:trkpt></g:gpx>')
  })

  it('reads back what it wrote', () => {
    expect(readGpx(writeElevations(track, 'trkpt', [1, 2, 3])).elevations).toEqual([1, 2, 3])
  })

  it('refuses a count that does not match', () => {
    expect(() => writeElevations(track, 'trkpt', [1, 2])).toThrow(GpxError)
    expect(() => writeElevations(track, 'trkpt', [1, 2, 3, 4])).toThrow(GpxError)
  })
})
