// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { GpxParseError, parseGpx } from './parser'

function gpx(body: string, attrs = 'xmlns="http://www.topografix.com/GPX/1/1"'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test" ${attrs}>${body}</gpx>`
}

const TRACK = gpx(`
  <metadata><name>Alpe Test</name></metadata>
  <trk>
    <name>Track name</name>
    <trkseg>
      <trkpt lat="47.0000" lon="11.0000"><ele>800.0</ele></trkpt>
      <trkpt lat="47.0010" lon="11.0005"><ele>812.5</ele></trkpt>
      <trkpt lat="47.0020" lon="11.0010"><ele>825.0</ele></trkpt>
    </trkseg>
  </trk>
`)

describe('parseGpx', () => {
  it('reads track points with coordinates and elevation', () => {
    const parsed = parseGpx(TRACK)
    expect(parsed.points).toHaveLength(3)
    expect(parsed.hasElevation).toBe(true)
    expect(parsed.points[0]).toEqual({ lat: 47, lon: 11, ele: 800 })
    expect(parsed.points[2]!.ele).toBe(825)
  })

  it('prefers the metadata name over the track name', () => {
    expect(parseGpx(TRACK).name).toBe('Alpe Test')
  })

  it('falls back to the track name', () => {
    const xml = gpx(`
      <trk><name>Just the track</name><trkseg>
        <trkpt lat="47" lon="11"><ele>0</ele></trkpt>
        <trkpt lat="47.001" lon="11"><ele>1</ele></trkpt>
      </trkseg></trk>
    `)
    expect(parseGpx(xml).name).toBe('Just the track')
  })

  it('returns a null name when the file has none', () => {
    const xml = gpx(`
      <trk><trkseg>
        <trkpt lat="47" lon="11"><ele>0</ele></trkpt>
      </trkseg></trk>
    `)
    expect(parseGpx(xml).name).toBeNull()
  })

  it('handles a prefixed namespace', () => {
    const xml = `<?xml version="1.0"?>
      <g:gpx xmlns:g="http://www.topografix.com/GPX/1/1">
        <g:trk><g:trkseg>
          <g:trkpt lat="47" lon="11"><g:ele>500</g:ele></g:trkpt>
        </g:trkseg></g:trk>
      </g:gpx>`
    const parsed = parseGpx(xml)
    expect(parsed.points).toEqual([{ lat: 47, lon: 11, ele: 500 }])
  })

  it('handles a file with no namespace at all', () => {
    const xml = parseGpx(gpx('<trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>', ''))
    expect(xml.points).toEqual([{ lat: 1, lon: 2, ele: 0 }])
  })

  it('falls back to route points when there is no track', () => {
    const xml = gpx(`
      <rte>
        <rtept lat="47" lon="11"><ele>100</ele></rtept>
        <rtept lat="47.001" lon="11"><ele>110</ele></rtept>
      </rte>
    `)
    const parsed = parseGpx(xml)
    expect(parsed.points).toHaveLength(2)
    expect(parsed.points[1]!.ele).toBe(110)
  })

  it('prefers track points when a file has both', () => {
    const xml = gpx(`
      <trk><trkseg><trkpt lat="47" lon="11"><ele>1</ele></trkpt></trkseg></trk>
      <rte><rtept lat="10" lon="10"><ele>999</ele></rtept></rte>
    `)
    expect(parseGpx(xml).points).toEqual([{ lat: 47, lon: 11, ele: 1 }])
  })
})

describe('parseGpx elevation handling', () => {
  it('flags a file with no elevation and reads it as flat', () => {
    const xml = gpx(`
      <trk><trkseg>
        <trkpt lat="47" lon="11"/>
        <trkpt lat="47.001" lon="11"/>
      </trkseg></trk>
    `)
    const parsed = parseGpx(xml)
    expect(parsed.hasElevation).toBe(false)
    expect(parsed.points.map((p) => p.ele)).toEqual([0, 0])
  })

  it('carries the last known elevation across gaps', () => {
    const xml = gpx(`
      <trk><trkseg>
        <trkpt lat="47.000" lon="11"><ele>100</ele></trkpt>
        <trkpt lat="47.001" lon="11"/>
        <trkpt lat="47.002" lon="11"><ele>120</ele></trkpt>
      </trkseg></trk>
    `)
    expect(parseGpx(xml).points.map((p) => p.ele)).toEqual([100, 100, 120])
  })

  it('backfills a leading gap from the first known elevation', () => {
    const xml = gpx(`
      <trk><trkseg>
        <trkpt lat="47.000" lon="11"/>
        <trkpt lat="47.001" lon="11"><ele>250</ele></trkpt>
      </trkseg></trk>
    `)
    expect(parseGpx(xml).points.map((p) => p.ele)).toEqual([250, 250])
  })
})

describe('parseGpx rejections', () => {
  it('rejects malformed XML', () => {
    expect(() => parseGpx('<gpx><trk>')).toThrow(GpxParseError)
  })

  it('rejects XML that is not GPX', () => {
    expect(() => parseGpx('<?xml version="1.0"?><kml><Placemark/></kml>')).toThrow(
      /not a GPX file/,
    )
  })

  it('rejects a GPX file with no points', () => {
    expect(() => parseGpx(gpx('<trk><trkseg/></trk>'))).toThrow(/no track or route points/)
  })

  it('rejects a point with no coordinates', () => {
    expect(() => parseGpx(gpx('<trk><trkseg><trkpt/></trkseg></trk>'))).toThrow(
      /missing a valid lat\/lon/,
    )
  })

  it('rejects out-of-range coordinates', () => {
    const xml = gpx('<trk><trkseg><trkpt lat="91" lon="11"/></trkseg></trk>')
    expect(() => parseGpx(xml)).toThrow(/out-of-range/)
  })
})
