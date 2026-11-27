import { describe, expect, it } from 'vitest'

import { bridgeGaps, buildProfile, heightsAt, median, resample, roadHeights, spanStructures } from './profile.ts'

describe('resample', () => {
  it('steps along the line and keeps the end', () => {
    const r = resample([
      { x: 0, z: 0 },
      { x: 12, z: 0 },
      { x: 12, z: 11 },
    ])
    expect(r.distance).toEqual([0, 5, 10, 15, 20, 23])
    expect(r.points[3]).toEqual({ x: 12, z: 3 })
    expect(r.points[5]).toEqual({ x: 12, z: 11 })
  })

  it('ignores repeated points', () => {
    const r = resample([
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ])
    expect(r.distance).toEqual([0, 5, 10])
  })
})

describe('roadHeights', () => {
  // A road climbing 2% eastward on a level shelf cut into a 60% hillside. The
  // shelf runs from z = 0 to z = 6 (south of the line); the line itself sits
  // 3 m up the bank, as a GPS trace easily can.
  const base = (x: number) => 0.02 * x
  const ground = (x: number, z: number) => {
    if (z < 0) return base(x) + 0.6 * -z
    if (z > 6) return base(x) - 0.6 * (z - 6)
    return base(x)
  }

  it('finds the shelf rather than the bank the line sits on', () => {
    const points = [0, 5, 10, 15, 20].map((x) => ({ x, z: -3 }))
    const heights = roadHeights(points, ground)
    heights.forEach((h, k) => expect(h).toBeCloseTo(base(points[k]!.x), 6))
    expect(ground(0, -3)).toBeCloseTo(1.8) // what sampling the line itself would have said
  })

  it('is NaN where the terrain model has nothing', () => {
    expect(roadHeights([{ x: 0, z: 0 }], () => Number.NaN)).toEqual([Number.NaN])
    const points = [0, 5, 10].map((x) => ({ x, z: 0 }))
    expect(roadHeights(points, (x) => (x > 2 && x < 8 ? Number.NaN : 1))).toEqual([1, Number.NaN, 1])
  })

  // Farmland: the road carries a slight camber, and for 30 m a perfectly flat
  // field lies 6 m to the south and 4 m lower.
  const camber = (x: number, z: number) => {
    const field = x >= 50 && x <= 80 && z >= 4.5
    return field ? 46 : 50 - 0.04 * z
  }
  const lane = Array.from({ length: 27 }, (_, k) => ({ x: k * 5, z: 0 }))

  it('does not hop onto a flatter field beside the road', () => {
    roadHeights(lane, camber).forEach((h) => expect(h).toBeCloseTo(50, 1))
  })

  it('would hop, choosing each point alone', () => {
    const alone = roadHeights(lane, camber, 0)
    expect(alone.filter((h) => h === 46)).toHaveLength(7)
  })
})

describe('bridgeGaps', () => {
  const flat = (n: number, h = 100) => Array.from({ length: n }, () => h)

  it('lays a level deck across a gorge the terrain model shows under a bridge', () => {
    const gorge = [...flat(20), 95, 85, 80, 80, 80, 80, 80, 80, 85, 95, ...flat(20)]
    const { values, spans } = bridgeGaps(gorge)
    values.forEach((v) => expect(v).toBeCloseTo(100, 6))
    expect(spans).toEqual([[19, 30]])
  })

  it('takes the hill off a tunnel', () => {
    const tunnel = [...flat(10), 104, 120, 140, 140, 120, 104, ...flat(10)]
    const { values } = bridgeGaps(tunnel)
    values.forEach((v) => expect(v).toBeCloseTo(100, 6))
  })

  it('leaves a steep but real climb alone', () => {
    const climb = Array.from({ length: 40 }, (_, k) => 100 + k * 5 * 0.2) // 20%
    expect(bridgeGaps(climb)).toEqual({ values: climb, spans: [] })
  })

  it('keeps the slope of a bridge that is not level', () => {
    // 2% up across the deck, with the gorge beneath
    const deck = Array.from({ length: 30 }, (_, k) => 100 + k * 0.1)
    for (let k = 10; k < 20; k++) deck[k] = 70
    const { values } = bridgeGaps(deck)
    values.forEach((v, k) => expect(v).toBeCloseTo(100 + k * 0.1, 6))
  })
})

describe('median', () => {
  it('removes a one-sample spike', () => {
    expect(median([1, 1, 9, 1, 1], 2)).toEqual([1, 1, 1, 1, 1])
  })
})

describe('buildProfile', () => {
  it('reports a bridge by distance along the road', () => {
    const points = Array.from({ length: 60 }, (_, k) => ({ x: k * 5, z: 0 }))
    const distance = points.map((p) => p.x)
    // flat road at 50 m; the terrain model drops 25 m beneath a bridge from 100 to 160 m
    const ground = (x: number) => (x > 100 && x < 160 ? 25 : 50)
    const profile = buildProfile({ points, distance }, ground)
    expect(profile.missing).toBe(0)
    profile.heights.forEach((h) => expect(h).toBeCloseTo(50, 6))
    expect(profile.bridged).toHaveLength(1)
    expect(profile.bridged[0]!.from).toBeLessThanOrEqual(100)
    expect(profile.bridged[0]!.to).toBeGreaterThanOrEqual(160)
  })

  it('fills holes from neighbours and counts them', () => {
    const points = Array.from({ length: 10 }, (_, k) => ({ x: k * 5, z: 0 }))
    const profile = buildProfile({ points, distance: points.map((p) => p.x) }, (x) => (x === 20 ? Number.NaN : 7))
    expect(profile.missing).toBe(1)
    profile.heights.forEach((h) => expect(h).toBeCloseTo(7, 6))
  })
})

describe('heightsAt', () => {
  it('interpolates, and holds the ends', () => {
    const profile = { distance: [0, 5, 10], heights: [100, 101, 103] }
    expect(heightsAt(profile, [0, 2.5, 7.5, 10, 12])).toEqual([100, 100.5, 102, 103, 103])
  })
})

describe('spanStructures', () => {
  it('lays a straight line over a mapped bridge, from ground on either side', () => {
    const distance = Array.from({ length: 41 }, (_, k) => k * 5)
    // road at 100 m rising 1 m per 50 m; the ground drops 8 m in a dip the bridge from 80 to 120 m crosses
    const ground = distance.map((d) => 100 + d / 50 - (d > 80 && d < 120 ? 8 : 0))
    const out = spanStructures(ground, distance, [{ from: 80, to: 120 }])
    out.forEach((h, k) => expect(h).toBeCloseTo(100 + distance[k]! / 50, 6))
  })

  it('takes a tunnel through the hill instead of over it', () => {
    const distance = Array.from({ length: 41 }, (_, k) => k * 5)
    const hill = distance.map((d) => 300 + (d > 60 && d < 140 ? 40 : 0))
    expect(Math.max(...spanStructures(hill, distance, [{ from: 60, to: 140 }]))).toBeCloseTo(300, 6)
  })

  it('leaves the road alone where nothing is mapped', () => {
    const distance = [0, 5, 10, 15]
    expect(spanStructures([1, 2, 3, 4], distance, [])).toEqual([1, 2, 3, 4])
  })
})
