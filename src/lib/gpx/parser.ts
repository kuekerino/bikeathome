/**
 * GPX reading. Pure apart from the one DOMParser call in `parseGpx`, so the
 * extraction logic can be tested against any Document implementation.
 */

export interface RawPoint {
  lat: number
  lon: number
  ele: number
}

export interface ParsedGpx {
  name: string | null
  points: RawPoint[]
  /** False when the file carried no elevation at all, so the route reads as flat. */
  hasElevation: boolean
}

export class GpxParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GpxParseError'
  }
}

export function parseGpx(xml: string): ParsedGpx {
  return extractGpx(new DOMParser().parseFromString(xml, 'application/xml'))
}

export function extractGpx(doc: Document): ParsedGpx {
  const failure = byLocalName(doc, 'parsererror')[0]
  if (failure) {
    throw new GpxParseError(`File is not valid XML: ${collapse(failure.textContent)}`)
  }
  if (byLocalName(doc, 'gpx').length === 0) {
    throw new GpxParseError('File has no <gpx> root element, so it is not a GPX file.')
  }

  // Track points are the normal case. Route points come from planning tools
  // that export a plotted line rather than a recorded ride.
  const elements = pick(byLocalName(doc, 'trkpt'), byLocalName(doc, 'rtept'))
  if (elements.length === 0) {
    throw new GpxParseError('File contains no track or route points.')
  }

  const lats: number[] = []
  const lons: number[] = []
  const eles: (number | null)[] = []

  for (const [index, element] of elements.entries()) {
    const lat = readNumber(element.getAttribute('lat'))
    const lon = readNumber(element.getAttribute('lon'))
    if (lat === null || lon === null) {
      throw new GpxParseError(`Point ${index + 1} is missing a valid lat/lon.`)
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new GpxParseError(`Point ${index + 1} has out-of-range coordinates (${lat}, ${lon}).`)
    }
    lats.push(lat)
    lons.push(lon)
    eles.push(readNumber(byLocalName(element, 'ele')[0]?.textContent))
  }

  const hasElevation = eles.some((value) => value !== null)
  const filled = hasElevation ? fillGaps(eles) : eles.map(() => 0)

  return {
    name: readName(doc),
    points: lats.map((lat, i) => ({ lat, lon: lons[i]!, ele: filled[i]! })),
    hasElevation,
  }
}

/**
 * Replace missing elevations by carrying the previous value forward, and
 * backfill any leading gaps from the first known value. Interpolating would
 * be prettier, but flat spots are safer than invented slopes.
 */
function fillGaps(values: (number | null)[]): number[] {
  const first = values.find((value) => value !== null) ?? 0
  let carried = first
  return values.map((value) => {
    if (value !== null) carried = value
    return carried
  })
}

function readName(doc: Document): string | null {
  const metadata = byLocalName(doc, 'metadata')[0]
  const candidates = [
    metadata ? byLocalName(metadata, 'name')[0] : undefined,
    byLocalName(doc, 'trk')[0] ? byLocalName(byLocalName(doc, 'trk')[0]!, 'name')[0] : undefined,
  ]
  for (const candidate of candidates) {
    const text = collapse(candidate?.textContent)
    if (text) return text
  }
  return null
}

function readNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** Match on local name so namespaced and prefixed GPX files both work. */
function byLocalName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName))
}

function pick(...groups: Element[][]): Element[] {
  return groups.find((group) => group.length > 0) ?? []
}

function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}
