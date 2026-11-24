/**
 * Reading points from a GPX file and writing new elevations back into it.
 *
 * Text in, text out, on purpose: the course tool runs under plain Node, which
 * has no DOMParser, and rewriting only the `<ele>` values leaves everything
 * else in the file (times, heart rate extensions, names, formatting) exactly
 * as it was. The choice of points matches the app's parser: track points if
 * there are any, route points otherwise, with or without a namespace prefix.
 */

import type { LatLon } from './geo.ts'

export interface GpxTrack {
  name: string | null
  points: LatLon[]
  /** The file's own elevation for each point, null where it has none. */
  elevations: (number | null)[]
  /** Which element the points came from, so a rewrite touches the same ones. */
  kind: 'trkpt' | 'rtept'
}

export class GpxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GpxError'
  }
}

/** One `<trkpt>` or `<rtept>`, self-closing or with children; any namespace prefix. */
function pointPattern(kind: 'trkpt' | 'rtept'): RegExp {
  return new RegExp(
    `<((?:[\\w.-]+:)?${kind})\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/\\1\\s*>)`,
    'g',
  )
}

export function readGpx(xml: string): GpxTrack {
  if (!/<(?:[\w.-]+:)?gpx\b/.test(xml)) {
    throw new GpxError('File has no <gpx> root element, so it is not a GPX file.')
  }

  for (const kind of ['trkpt', 'rtept'] as const) {
    const points: LatLon[] = []
    const elevations: (number | null)[] = []
    for (const match of xml.matchAll(pointPattern(kind))) {
      const attributes = match[2] ?? ''
      const lat = readAttribute(attributes, 'lat')
      const lon = readAttribute(attributes, 'lon')
      if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        throw new GpxError(`Point ${points.length + 1} is missing a valid lat/lon.`)
      }
      points.push({ lat, lon })
      const ele = /<(?:[\w.-]+:)?ele\s*>([^<]*)</.exec(match[3] ?? '')?.[1]?.trim()
      elevations.push(ele && Number.isFinite(Number(ele)) ? Number(ele) : null)
    }
    if (points.length > 0) return { name: readName(xml), points, elevations, kind }
  }

  throw new GpxError('File contains no track or route points.')
}

/**
 * Returns the same document with each point's elevation replaced, in order.
 * A point without an `<ele>` gets one as its first child, where the GPX
 * schema puts it.
 */
export function writeElevations(xml: string, kind: 'trkpt' | 'rtept', elevations: readonly number[]): string {
  let index = 0
  const out = xml.replace(pointPattern(kind), (_whole, tag: string, attributes: string, body: string | undefined) => {
    const value = elevations[index++]
    if (value === undefined) throw new GpxError('Fewer elevations than points.')
    const ele = value.toFixed(2)
    const prefix = tag.includes(':') ? tag.slice(0, tag.indexOf(':') + 1) : ''
    const existing = /<((?:[\w.-]+:)?ele)\s*>[^<]*<\/\1\s*>/
    const inner =
      body !== undefined && existing.test(body)
        ? body.replace(existing, (_m, eleTag: string) => `<${eleTag}>${ele}</${eleTag}>`)
        : `<${prefix}ele>${ele}</${prefix}ele>${body ?? ''}`
    return `<${tag}${attributes}>${inner}</${tag}>`
  })
  if (index !== elevations.length) throw new GpxError('More elevations than points.')
  return out
}

function readAttribute(attributes: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`).exec(attributes)
  if (!match) return null
  const trimmed = (match[2] ?? '').trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** The metadata name if there is one, otherwise the first track's. */
function readName(xml: string): string | null {
  const metadata = /<(?:[\w.-]+:)?metadata\b[\s\S]*?<\/(?:[\w.-]+:)?metadata\s*>/.exec(xml)?.[0]
  const track = /<(?:[\w.-]+:)?trk\b[\s\S]*?<\/(?:[\w.-]+:)?trk\s*>/.exec(xml)?.[0]
  for (const scope of [metadata, track]) {
    if (!scope) continue
    const raw = /<(?:[\w.-]+:)?name\s*>([\s\S]*?)<\/(?:[\w.-]+:)?name\s*>/.exec(scope)?.[1]
    const text = decodeEntities(raw ?? '').replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  return null
}

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
