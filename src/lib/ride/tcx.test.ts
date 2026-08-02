// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { RideSample } from './recorder'
import { buildTcx, tcxFilename } from './tcx'

const START_MS = Date.UTC(2026, 7, 2, 14, 31, 0, 0)

const GOLDEN_SAMPLES: RideSample[] = [
  {
    time: START_MS,
    distanceM: 0,
    lat: 46.5,
    lon: 11.35,
    altitudeM: 620,
    powerW: 183,
    cadenceRpm: 85,
    speedMs: 0,
  },
  {
    time: START_MS + 900_000,
    distanceM: 6000.25,
    lat: 46.55,
    lon: 11.4,
    altitudeM: 650.5,
    powerW: 210,
    cadenceRpm: 90,
    speedMs: 9.5,
  },
  {
    time: START_MS + 1_830_000,
    distanceM: 12020.5,
    lat: 46.6,
    lon: 11.45,
    altitudeM: 610.2,
    powerW: 195.4,
    cadenceRpm: 88,
    speedMs: 13.789,
  },
]

function sample(overrides: Partial<RideSample> = {}): RideSample {
  return {
    time: START_MS,
    distanceM: 0,
    lat: 46.5,
    lon: 11.35,
    altitudeM: 620,
    powerW: 183,
    cadenceRpm: 85,
    speedMs: 0,
    ...overrides,
  }
}

describe('buildTcx', () => {
  it('throws on an empty ride', () => {
    expect(() => buildTcx([])).toThrow(/empty/i)
  })

  it('produces a well-formed document jsdom can parse without error', () => {
    const xml = buildTcx(GOLDEN_SAMPLES)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  })

  it('matches the expected structure byte for byte', () => {
    expect(buildTcx(GOLDEN_SAMPLES)).toBe(EXPECTED_GOLDEN_TCX)
  })

  it('uses the first sample time for Id and Lap StartTime', () => {
    const xml = buildTcx(GOLDEN_SAMPLES)
    const isoStart = new Date(START_MS).toISOString()
    expect(xml).toContain(`<Id>${isoStart}</Id>`)
    expect(xml).toContain(`<Lap StartTime="${isoStart}">`)
  })

  it('computes TotalTimeSeconds from first and last sample time', () => {
    const xml = buildTcx(GOLDEN_SAMPLES)
    expect(xml).toContain('<TotalTimeSeconds>1830.0</TotalTimeSeconds>')
  })

  it('uses the last sample distance for the lap DistanceMeters', () => {
    const xml = buildTcx(GOLDEN_SAMPLES)
    expect(xml).toContain('<DistanceMeters>12020.5</DistanceMeters>')
  })

  it('reports the highest speed seen as MaximumSpeed', () => {
    const xml = buildTcx(GOLDEN_SAMPLES)
    expect(xml).toContain('<MaximumSpeed>13.789</MaximumSpeed>')
  })

  it('emits one Trackpoint per sample', () => {
    const xml = buildTcx(GOLDEN_SAMPLES)
    expect(xml.match(/<Trackpoint>/g)).toHaveLength(3)
  })

  it('rounds and clamps cadence into a byte', () => {
    const xml = buildTcx([sample({ cadenceRpm: 84.6 })])
    expect(xml).toContain('<Cadence>85</Cadence>')

    const tooHigh = buildTcx([sample({ cadenceRpm: 300 })])
    expect(tooHigh).toContain('<Cadence>254</Cadence>')

    const negative = buildTcx([sample({ cadenceRpm: -5 })])
    expect(negative).toContain('<Cadence>0</Cadence>')
  })

  it('rounds and clamps watts at zero', () => {
    const xml = buildTcx([sample({ powerW: 182.5 })])
    expect(xml).toContain('<ns3:Watts>183</ns3:Watts>')

    const negative = buildTcx([sample({ powerW: -40 })])
    expect(negative).toContain('<ns3:Watts>0</ns3:Watts>')
  })

  it('includes a Notes element with the ride name, XML-escaped', () => {
    const xml = buildTcx([sample()], { name: 'Alpe & <Friends>' })
    expect(xml).toContain('<Notes>Alpe &amp; &lt;Friends&gt;</Notes>')
  })

  it('omits Notes when no name is given', () => {
    const xml = buildTcx([sample()])
    expect(xml).not.toContain('<Notes>')
  })
})

describe('tcxFilename', () => {
  it('formats the local date and time, zero-padded', () => {
    const localMidday = new Date(2026, 7, 2, 14, 31, 0)
    expect(tcxFilename(localMidday.getTime())).toBe('ride-20260802-1431.tcx')
  })

  it('zero-pads single-digit month, day, hour and minute', () => {
    const early = new Date(2026, 0, 5, 6, 7, 0)
    expect(tcxFilename(early.getTime())).toBe('ride-20260105-0607.tcx')
  })
})

const EXPECTED_GOLDEN_TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-08-02T14:31:00.000Z</Id>
      <Lap StartTime="2026-08-02T14:31:00.000Z">
        <TotalTimeSeconds>1830.0</TotalTimeSeconds>
        <DistanceMeters>12020.5</DistanceMeters>
        <MaximumSpeed>13.789</MaximumSpeed>
        <Calories>0</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          <Trackpoint>
            <Time>2026-08-02T14:31:00.000Z</Time>
            <Position>
              <LatitudeDegrees>46.500000</LatitudeDegrees>
              <LongitudeDegrees>11.350000</LongitudeDegrees>
            </Position>
            <AltitudeMeters>620.0</AltitudeMeters>
            <DistanceMeters>0.0</DistanceMeters>
            <Cadence>85</Cadence>
            <Extensions>
              <ns3:TPX>
                <ns3:Speed>0.000</ns3:Speed>
                <ns3:Watts>183</ns3:Watts>
              </ns3:TPX>
            </Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-08-02T14:46:00.000Z</Time>
            <Position>
              <LatitudeDegrees>46.550000</LatitudeDegrees>
              <LongitudeDegrees>11.400000</LongitudeDegrees>
            </Position>
            <AltitudeMeters>650.5</AltitudeMeters>
            <DistanceMeters>6000.3</DistanceMeters>
            <Cadence>90</Cadence>
            <Extensions>
              <ns3:TPX>
                <ns3:Speed>9.500</ns3:Speed>
                <ns3:Watts>210</ns3:Watts>
              </ns3:TPX>
            </Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-08-02T15:01:30.000Z</Time>
            <Position>
              <LatitudeDegrees>46.600000</LatitudeDegrees>
              <LongitudeDegrees>11.450000</LongitudeDegrees>
            </Position>
            <AltitudeMeters>610.2</AltitudeMeters>
            <DistanceMeters>12020.5</DistanceMeters>
            <Cadence>88</Cadence>
            <Extensions>
              <ns3:TPX>
                <ns3:Speed>13.789</ns3:Speed>
                <ns3:Watts>195</ns3:Watts>
              </ns3:TPX>
            </Extensions>
          </Trackpoint>
        </Track>
      </Lap>
      <Creator xsi:type="Device_t">
        <Name>bikeathome</Name>
        <UnitId>0</UnitId>
        <ProductID>0</ProductID>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`
