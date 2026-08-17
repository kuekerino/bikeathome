import { describe, expect, it } from 'vitest'
import {
  describeStep,
  flatten,
  needsFtp,
  resolveIntensity,
  stepAt,
  totalSeconds,
  wattsAt,
  type Workout,
  type WorkoutStep,
} from './model'

const watts = (w: number) => ({ kind: 'watts', watts: w }) as const
const ftp = (f: number) => ({ kind: 'ftp', fraction: f }) as const

const steady = (seconds: number, w: number): WorkoutStep => ({
  seconds,
  from: watts(w),
  to: watts(w),
})

const intervals: Workout = {
  name: '6 × 3',
  blocks: [
    { kind: 'step', step: { seconds: 600, from: watts(100), to: watts(200) } },
    { kind: 'repeat', times: 6, steps: [steady(180, 300), steady(180, 150)] },
    { kind: 'step', step: steady(300, 120) },
  ],
}

describe('flatten', () => {
  it('unrolls a repeat into consecutive steps', () => {
    const flat = flatten(intervals)
    expect(flat).toHaveLength(1 + 6 * 2 + 1)
  })

  it('keeps which pass through the repeat each step belongs to', () => {
    // The whole reason the tree exists: a rider wants "interval 4 of 6", not
    // "step 8 of 13".
    const flat = flatten(intervals)
    expect(flat[0]?.repeat).toBeUndefined()
    expect(flat[1]?.repeat).toEqual({ index: 1, total: 6 })
    expect(flat[7]?.repeat).toEqual({ index: 4, total: 6 })
    expect(flat[13]?.repeat).toBeUndefined()
  })

  it('lays the steps end to end with no gaps', () => {
    const flat = flatten(intervals)
    for (const [a, b] of flat.map((s, i) => [s, flat[i + 1]] as const)) {
      if (b) expect(b.startSeconds).toBe(a.endSeconds)
    }
    expect(flat[0]?.startSeconds).toBe(0)
  })

  it('totals the whole session', () => {
    expect(totalSeconds(flatten(intervals))).toBe(600 + 6 * 360 + 300)
  })

  it('copes with an empty workout', () => {
    expect(flatten({ name: 'Nothing', blocks: [] })).toEqual([])
    expect(totalSeconds([])).toBe(0)
  })
})

describe('stepAt', () => {
  const flat = flatten(intervals)

  it('finds the step in force', () => {
    expect(stepAt(flat, 0)).toBe(flat[0])
    expect(stepAt(flat, 599)).toBe(flat[0])
    expect(stepAt(flat, 600)).toBe(flat[1])
  })

  it('treats a boundary as belonging to the step starting there', () => {
    // Otherwise the last instant of a step and the first of the next both
    // match, and which one wins depends on the search order.
    const boundary = flat[1]?.endSeconds ?? 0
    expect(stepAt(flat, boundary)).toBe(flat[2])
  })

  it('says nothing once the workout is over', () => {
    expect(stepAt(flat, totalSeconds(flat))).toBeUndefined()
    expect(stepAt(flat, 99_999)).toBeUndefined()
  })
})

describe('resolveIntensity', () => {
  it('takes absolute watts as they are, FTP or no FTP', () => {
    expect(resolveIntensity(watts(250), null)).toBe(250)
    expect(resolveIntensity(watts(250), 200)).toBe(250)
  })

  it('resolves a fraction against the FTP', () => {
    expect(resolveIntensity(ftp(0.75), 200)).toBe(150)
  })

  it('refuses a fraction with no FTP rather than guessing', () => {
    // Riding 60% of a number nobody chose is worse than not starting.
    expect(resolveIntensity(ftp(0.6), null)).toBeNull()
  })

  it('has no target for a free-ride step', () => {
    expect(resolveIntensity({ kind: 'free' }, 200)).toBeNull()
  })
})

describe('wattsAt', () => {
  const ramp: WorkoutStep = { seconds: 100, from: watts(100), to: watts(200) }

  it('interpolates across a ramp', () => {
    expect(wattsAt(ramp, 0, null)).toBe(100)
    expect(wattsAt(ramp, 50, null)).toBe(150)
    expect(wattsAt(ramp, 100, null)).toBe(200)
  })

  it('clamps outside the step rather than extrapolating', () => {
    expect(wattsAt(ramp, -10, null)).toBe(100)
    expect(wattsAt(ramp, 500, null)).toBe(200)
  })

  it('holds a steady step flat', () => {
    expect(wattsAt(steady(100, 180), 50, null)).toBe(180)
  })

  it('ramps in FTP terms too', () => {
    const relative: WorkoutStep = { seconds: 100, from: ftp(0.5), to: ftp(1) }
    expect(wattsAt(relative, 50, 200)).toBe(150)
  })

  it('survives a zero-length step', () => {
    expect(wattsAt({ seconds: 0, from: watts(100), to: watts(200) }, 0, null)).toBe(100)
  })
})

describe('needsFtp', () => {
  it('is false for a workout written entirely in watts', () => {
    // Which is exactly what an FTP test has to be.
    expect(needsFtp(intervals)).toBe(false)
  })

  it('is true as soon as one step is relative', () => {
    expect(
      needsFtp({ name: 'x', blocks: [{ kind: 'step', step: { seconds: 60, from: ftp(0.7), to: ftp(0.7) } }] }),
    ).toBe(true)
  })

  it('looks inside repeats', () => {
    expect(
      needsFtp({
        name: 'x',
        blocks: [{ kind: 'repeat', times: 2, steps: [{ seconds: 60, from: ftp(1), to: ftp(1) }] }],
      }),
    ).toBe(true)
  })
})

describe('describeStep', () => {
  it('names a ramp as a range', () => {
    expect(describeStep({ seconds: 60, from: watts(100), to: watts(200) }, null)).toBe(
      '100 → 200 W',
    )
  })

  it('names a steady step as one number', () => {
    expect(describeStep(steady(60, 180), null)).toBe('180 W')
  })

  it('says what is missing rather than showing a wrong number', () => {
    expect(describeStep({ seconds: 60, from: ftp(0.7), to: ftp(0.7) }, null)).toBe('needs an FTP')
  })
})
