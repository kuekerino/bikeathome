/**
 * Reading Zwift's `.zwo` workout files.
 *
 * Chosen over the alternatives because thousands of published workouts already
 * exist in it, and because it is the only common format that carries a repeat
 * rather than flattening intervals into a list of time/power points.
 *
 * Pure apart from the one DOMParser call, matching the GPX reader next door.
 */

import type { Intensity, Workout, WorkoutBlock, WorkoutStep } from './model'

export class ZwoParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZwoParseError'
  }
}

/**
 * Zwift writes intensities as a fraction of FTP — `0.75` for 75%. Values above
 * this are read as absolute watts instead, which is the convention other tools
 * use and the only way a file can describe a test protocol.
 *
 * Applied here at import and nowhere else: the model keeps the two apart
 * properly, and a magic threshold loose inside it would spread everywhere.
 */
const WATTS_THRESHOLD = 10

export function parseZwo(xml: string): Workout {
  return extractZwo(new DOMParser().parseFromString(xml, 'application/xml'))
}

export function extractZwo(doc: Document): Workout {
  const failure = byLocalName(doc, 'parsererror')[0]
  if (failure) {
    throw new ZwoParseError(`File is not valid XML: ${collapse(failure.textContent)}`)
  }
  if (byLocalName(doc, 'workout_file').length === 0) {
    throw new ZwoParseError('File has no <workout_file> root, so it is not a Zwift workout.')
  }

  const body = byLocalName(doc, 'workout')[0]
  if (!body) throw new ZwoParseError('Workout has no <workout> section, so there is nothing to ride.')

  const blocks: WorkoutBlock[] = []
  for (const element of Array.from(body.children)) {
    const block = readBlock(element)
    if (block) blocks.push(block)
  }

  if (blocks.length === 0) {
    throw new ZwoParseError('Workout has no steps this app understands.')
  }

  return {
    name: text(doc, 'name') ?? 'Workout',
    description: text(doc, 'description') ?? undefined,
    blocks,
  }
}

function readBlock(element: Element): WorkoutBlock | null {
  const tag = element.localName.toLowerCase()
  const cadence = optionalNumber(element, 'Cadence') ?? undefined

  switch (tag) {
    case 'warmup':
    case 'ramp':
    case 'cooldown': {
      const seconds = duration(element)
      const low = intensity(element, ['PowerLow', 'Power'])
      const high = intensity(element, ['PowerHigh', 'Power'])
      if (seconds === null || !low || !high) return null

      // A cooldown descends, whichever way round the file names its bounds.
      // Files disagree about that, and a cooldown that ramps *up* is never
      // what was meant.
      const [from, to] =
        tag === 'cooldown' && compare(low, high) < 0 ? [high, low] : [low, high]

      return { kind: 'step', step: step(seconds, from, to, cadence, capitalise(tag)) }
    }

    case 'steadystate': {
      const seconds = duration(element)
      const power = intensity(element, ['Power', 'PowerLow'])
      if (seconds === null || !power) return null
      return { kind: 'step', step: step(seconds, power, power, cadence, 'Steady') }
    }

    case 'freeride': {
      const seconds = duration(element)
      if (seconds === null) return null
      const free: Intensity = { kind: 'free' }
      return { kind: 'step', step: step(seconds, free, free, cadence, 'Free ride') }
    }

    case 'intervalst': {
      const times = Math.max(1, Math.round(optionalNumber(element, 'Repeat') ?? 1))
      const on = optionalNumber(element, 'OnDuration')
      const off = optionalNumber(element, 'OffDuration')
      const onPower = intensity(element, ['OnPower'])
      const offPower = intensity(element, ['OffPower'])
      if (on === null || off === null || !onPower || !offPower) return null

      const offCadence = optionalNumber(element, 'CadenceResting') ?? undefined

      return {
        kind: 'repeat',
        times,
        steps: [
          step(on, onPower, onPower, cadence, 'On'),
          step(off, offPower, offPower, offCadence, 'Off'),
        ],
      }
    }

    // textevent and anything else carries no resistance instruction.
    default:
      return null
  }
}

function step(
  seconds: number,
  from: Intensity,
  to: Intensity,
  cadenceRpm: number | undefined,
  label: string,
): WorkoutStep {
  return {
    seconds,
    from,
    to,
    ...(cadenceRpm !== undefined && cadenceRpm > 0 ? { cadenceRpm: Math.round(cadenceRpm) } : {}),
    label,
  }
}

/** Orders two intensities well enough to spot a cooldown written backwards. */
function compare(a: Intensity, b: Intensity): number {
  const value = (i: Intensity) => (i.kind === 'watts' ? i.watts : i.kind === 'ftp' ? i.fraction : 0)
  // Only meaningful when both are the same kind, which within one element they are.
  return value(a) - value(b)
}

function duration(element: Element): number | null {
  const seconds = optionalNumber(element, 'Duration')
  return seconds !== null && seconds > 0 ? Math.round(seconds) : null
}

function intensity(element: Element, names: readonly string[]): Intensity | null {
  for (const name of names) {
    const value = optionalNumber(element, name)
    if (value === null || value <= 0) continue
    return value > WATTS_THRESHOLD
      ? { kind: 'watts', watts: Math.round(value) }
      : { kind: 'ftp', fraction: value }
  }
  return null
}

/** Attributes are case-inconsistent across the tools that write these files. */
function optionalNumber(element: Element, name: string): number | null {
  const wanted = name.toLowerCase()
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.toLowerCase() !== wanted) continue
    const value = Number(attribute.value)
    return Number.isFinite(value) ? value : null
  }
  return null
}

function text(doc: Document, name: string): string | null {
  const found = byLocalName(doc, name)[0]?.textContent
  const trimmed = collapse(found)
  return trimmed.length > 0 ? trimmed : null
}

function byLocalName(root: Document, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(
    (element) => element.localName.toLowerCase() === name.toLowerCase(),
  )
}

function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function capitalise(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1)
}
