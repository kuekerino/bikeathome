// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flatten, totalSeconds } from './model'
import { parseZwo, ZwoParseError } from './zwo'

const wrap = (body: string, name = 'Test') => `<?xml version="1.0"?>
<workout_file>
  <name>${name}</name>
  <description>A session.</description>
  <workout>${body}</workout>
</workout_file>`

describe('parseZwo', () => {
  it('reads the elements a real workout is made of', () => {
    const workout = parseZwo(
      wrap(`
        <Warmup Duration="600" PowerLow="0.4" PowerHigh="0.75"/>
        <IntervalsT Repeat="6" OnDuration="180" OffDuration="180" OnPower="1.05" OffPower="0.6"/>
        <Cooldown Duration="300" PowerLow="0.7" PowerHigh="0.4"/>
      `),
    )

    expect(workout.name).toBe('Test')
    expect(workout.blocks).toHaveLength(3)
    expect(totalSeconds(flatten(workout))).toBe(600 + 6 * 360 + 300)
  })

  it('keeps a repeat as a repeat rather than flattening it on import', () => {
    const workout = parseZwo(
      wrap('<IntervalsT Repeat="4" OnDuration="60" OffDuration="60" OnPower="1" OffPower="0.5"/>'),
    )
    expect(workout.blocks[0]).toMatchObject({ kind: 'repeat', times: 4 })
    expect(flatten(workout)[6]?.repeat).toEqual({ index: 4, total: 4 })
  })

  it('reads a fraction as FTP and a large number as watts', () => {
    // The convention that makes a test protocol expressible at all: an FTP
    // test cannot be written as a share of the number it measures.
    const relative = parseZwo(wrap('<SteadyState Duration="60" Power="0.75"/>'))
    expect(relative.blocks[0]).toMatchObject({ step: { from: { kind: 'ftp', fraction: 0.75 } } })

    const absolute = parseZwo(wrap('<SteadyState Duration="60" Power="250"/>'))
    expect(absolute.blocks[0]).toMatchObject({ step: { from: { kind: 'watts', watts: 250 } } })
  })

  it('makes a warmup a ramp and a steady state flat', () => {
    const workout = parseZwo(
      wrap(`
        <Warmup Duration="60" PowerLow="0.4" PowerHigh="0.8"/>
        <SteadyState Duration="60" Power="0.7"/>
      `),
    )
    const [warmup, steady] = flatten(workout)
    expect(warmup?.step.from).not.toEqual(warmup?.step.to)
    expect(steady?.step.from).toEqual(steady?.step.to)
  })

  it('makes a cooldown descend however the file names its bounds', () => {
    // Files disagree about which attribute is the start, and a cooldown that
    // ramps up is never what was meant.
    for (const attrs of ['PowerLow="0.7" PowerHigh="0.4"', 'PowerLow="0.4" PowerHigh="0.7"']) {
      const workout = parseZwo(wrap(`<Cooldown Duration="300" ${attrs}/>`))
      const step = flatten(workout)[0]?.step
      expect(step?.from).toEqual({ kind: 'ftp', fraction: 0.7 })
      expect(step?.to).toEqual({ kind: 'ftp', fraction: 0.4 })
    }
  })

  it('carries a cadence target through', () => {
    const workout = parseZwo(wrap('<SteadyState Duration="60" Power="0.6" Cadence="90"/>'))
    expect(flatten(workout)[0]?.step.cadenceRpm).toBe(90)
  })

  it('gives the resting half of an interval its own cadence', () => {
    const workout = parseZwo(
      wrap(
        '<IntervalsT Repeat="2" OnDuration="60" OffDuration="60" OnPower="1" OffPower="0.5"' +
          ' Cadence="95" CadenceResting="85"/>',
      ),
    )
    const [on, off] = flatten(workout)
    expect(on?.step.cadenceRpm).toBe(95)
    expect(off?.step.cadenceRpm).toBe(85)
  })

  it('reads a free-ride block as having no target', () => {
    const workout = parseZwo(wrap('<FreeRide Duration="600" FlatRoad="1"/>'))
    expect(flatten(workout)[0]?.step.from).toEqual({ kind: 'free' })
  })

  it('does not mind how the attributes are cased', () => {
    // The tools that write these files do not agree with each other.
    const workout = parseZwo(wrap('<SteadyState duration="60" power="0.75"/>'))
    expect(flatten(workout)[0]?.step.seconds).toBe(60)
  })

  it('skips blocks that carry no resistance instruction', () => {
    const workout = parseZwo(
      wrap(`
        <textevent timeoffset="10" message="Go"/>
        <SteadyState Duration="60" Power="0.75"/>
      `),
    )
    expect(workout.blocks).toHaveLength(1)
  })

  it('rejects a file that is not a workout', () => {
    expect(() => parseZwo('<gpx></gpx>')).toThrow(ZwoParseError)
    expect(() => parseZwo('not xml at all <<<')).toThrow(ZwoParseError)
  })

  it('rejects a workout with nothing rideable in it', () => {
    expect(() => parseZwo(wrap('<textevent timeoffset="10" message="Go"/>'))).toThrow(
      /no steps this app understands/,
    )
  })

  it('rejects a step with no duration rather than riding it forever', () => {
    expect(() => parseZwo(wrap('<SteadyState Power="0.75"/>'))).toThrow(ZwoParseError)
  })

  it('falls back to a name when the file has none', () => {
    const workout = parseZwo(
      '<workout_file><workout><SteadyState Duration="60" Power="200"/></workout></workout_file>',
    )
    expect(workout.name).toBe('Workout')
  })
})
