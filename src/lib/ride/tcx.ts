/**
 * Serialises a recorded ride into a Garmin TCX v2 document — the format
 * Strava and most training platforms accept for a completed activity.
 *
 * No XML library: TCX's shape is fixed and small enough that a handful of
 * template strings are more trustworthy than a dependency neither this
 * project nor its build needs anywhere else.
 */

import type { RideSample } from './recorder'

const TCX_NAMESPACE = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2'
const ACTIVITY_EXTENSION_NAMESPACE = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2'
const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance'
const SCHEMA_LOCATION =
  'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 ' +
  'http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd'

export function buildTcx(samples: readonly RideSample[], options: { name?: string } = {}): string {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last) throw new Error('Cannot build a TCX file from an empty ride.')

  const startTime = new Date(first.time).toISOString()
  const totalTimeSeconds = ((last.time - first.time) / 1000).toFixed(1)
  const maxSpeed = Math.max(...samples.map((sample) => sample.speedMs))

  const notes = options.name ? `\n      <Notes>${escapeXml(options.name)}</Notes>` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="${TCX_NAMESPACE}"
  xmlns:ns3="${ACTIVITY_EXTENSION_NAMESPACE}"
  xmlns:xsi="${XSI_NAMESPACE}"
  xsi:schemaLocation="${SCHEMA_LOCATION}">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startTime}</Id>
      <Lap StartTime="${startTime}">
        <TotalTimeSeconds>${totalTimeSeconds}</TotalTimeSeconds>
        <DistanceMeters>${formatDistance(last.distanceM)}</DistanceMeters>
        <MaximumSpeed>${formatSpeed(maxSpeed)}</MaximumSpeed>
        <Calories>0</Calories>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${samples.map(formatTrackpoint).join('\n')}
        </Track>
      </Lap>${notes}
      <Creator xsi:type="Device_t">
        <Name>bikeathome</Name>
        <UnitId>0</UnitId>
        <ProductID>0</ProductID>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`
}

/** `ride-YYYYMMDD-HHMM.tcx`, in the recording's own local time — the time the rider saw. */
export function tcxFilename(startedAtMs: number): string {
  const date = new Date(startedAtMs)
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `ride-${year}${month}${day}-${hours}${minutes}.tcx`
}

function formatTrackpoint(sample: RideSample): string {
  return `          <Trackpoint>
            <Time>${new Date(sample.time).toISOString()}</Time>
            <Position>
              <LatitudeDegrees>${formatCoordinate(sample.lat)}</LatitudeDegrees>
              <LongitudeDegrees>${formatCoordinate(sample.lon)}</LongitudeDegrees>
            </Position>
            <AltitudeMeters>${formatDistance(sample.altitudeM)}</AltitudeMeters>
            <DistanceMeters>${formatDistance(sample.distanceM)}</DistanceMeters>
            <Cadence>${clampCadence(sample.cadenceRpm)}</Cadence>
            <Extensions>
              <ns3:TPX>
                <ns3:Speed>${formatSpeed(sample.speedMs)}</ns3:Speed>
                <ns3:Watts>${clampWatts(sample.powerW)}</ns3:Watts>
              </ns3:TPX>
            </Extensions>
          </Trackpoint>`
}

function formatCoordinate(value: number): string {
  return value.toFixed(6)
}

function formatDistance(value: number): string {
  return value.toFixed(1)
}

function formatSpeed(value: number): string {
  return value.toFixed(3)
}

/** TCX stores cadence in a single byte. */
function clampCadence(rpm: number): number {
  return Math.min(254, Math.max(0, Math.round(rpm)))
}

function clampWatts(watts: number): number {
  return Math.max(0, Math.round(watts))
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}
