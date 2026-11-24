import { describe, expect, it } from 'vitest'

import { localFrame, wgs84ToBng } from './geo.ts'

describe('localFrame', () => {
  const frame = localFrame({ lat: 39.75, lon: 2.75 })

  it('puts north at negative z and east at positive x', () => {
    const north = frame.toLocal({ lat: 39.75 + 1000 / 111195, lon: 2.75 })
    expect(north.z).toBeCloseTo(-1000, 0)
    expect(north.x).toBeCloseTo(0, 6)

    const east = frame.toLocal({ lat: 39.75, lon: 2.75 + 0.01 })
    expect(east.x).toBeGreaterThan(0)
    expect(east.z).toBeCloseTo(0, 6)
  })

  it('round-trips', () => {
    const p = { lat: 39.7812, lon: 2.6934 }
    const local = frame.toLocal(p)
    const back = frame.toLatLon(local.x, local.z)
    expect(back.lat).toBeCloseTo(p.lat, 10)
    expect(back.lon).toBeCloseTo(p.lon, 10)
  })
})

describe('wgs84ToBng', () => {
  // Reference values from golden-hour-ride's Python original, which this ports.
  it.each([
    [51.8826, -2.079, 394659.053, 220451.6285],
    [51.4778, -0.0014, 538890.101, 177320.4966],
    [54.5, -3.2, 322383.5556, 512293.5937],
    [50.1, -5.5, 149802.1826, 28080.3243],
  ])('matches the original at %f, %f', (lat, lon, easting, northing) => {
    const [e, n] = wgs84ToBng(lat, lon)
    expect(e).toBeCloseTo(easting, 2)
    expect(n).toBeCloseTo(northing, 2)
  })
})
