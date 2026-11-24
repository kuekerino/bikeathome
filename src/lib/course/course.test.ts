import { describe, expect, it } from 'vitest'

import {
  courseScript,
  decodeDem,
  encodeDem,
  fillTerrain,
  isLoop,
  mergeRevisits,
  MAX_TERRAIN_CELLS,
  planTerrain,
  roadLine,
  SEA_FLOOR_M,
  terrainVertices,
  type Course,
} from './course.ts'

describe('planTerrain', () => {
  it('surrounds a small course with the margin at 10 m cells', () => {
    const plan = planTerrain([{ x: -1500, z: 900 }, { x: 1400, z: -800 }], 1300)
    expect(plan.cell).toBe(10)
    expect(plan.size).toBe(5600) // 2 × (1500 + 1300), rounded up to 200 m
    expect(plan.cells).toBe(560)
  })

  it('widens the cells on a big course instead of growing the mesh', () => {
    const plan = planTerrain([{ x: -15000, z: 0 }, { x: 15000, z: 0 }], 1300)
    expect(plan.cells).toBeLessThanOrEqual(MAX_TERRAIN_CELLS)
    expect(plan.size).toBeGreaterThanOrEqual(2 * 16300)
    expect(plan.cell % 5).toBe(0)
  })
})

describe('terrainVertices', () => {
  it('starts at the north-west corner and runs east, then south', () => {
    const v = terrainVertices({ size: 20, cells: 2, cell: 10 })
    expect(v).toHaveLength(9)
    expect(v[0]).toEqual({ x: -10, z: -10 })
    expect(v[1]).toEqual({ x: 0, z: -10 })
    expect(v[3]).toEqual({ x: -10, z: 0 })
  })
})

describe('fillTerrain', () => {
  it('patches a small hole from around it and calls a wide one sea', () => {
    const width = 9
    const heights = new Float32Array(width * width).fill(50)
    heights[4 * width + 4] = Number.NaN
    const hole = fillTerrain(heights, width)
    expect(hole).toEqual({ holes: 1, sea: 0 })
    expect(heights[4 * width + 4]).toBeCloseTo(50)

    const ocean = new Float32Array(width * width).fill(Number.NaN)
    ocean[0] = 10
    const result = fillTerrain(ocean, width)
    expect(result.sea).toBeGreaterThan(0)
    expect(ocean[width * width - 1]).toBe(SEA_FLOOR_M)
    expect(ocean[1]).toBeCloseTo(10)
  })
})

describe('encodeDem', () => {
  it('round-trips to within a few centimetres on a mountain', () => {
    const heights = Float32Array.from({ length: 500 }, (_, k) => -2 + k * 2.9)
    const decoded = decodeDem(encodeDem(heights))
    decoded.forEach((h, k) => expect(Math.abs(h - heights[k]!)).toBeLessThan(0.02))
  })

  it('survives flat ground', () => {
    const decoded = decodeDem(encodeDem(new Float32Array(4).fill(12)))
    decoded.forEach((h) => expect(h).toBeCloseTo(12))
  })
})

describe('road line', () => {
  const points = Array.from({ length: 10 }, (_, k) => ({ x: k * 5, z: 0 }))
  const heights = points.map((_, k) => 100 + k)

  it('recognises a loop by its ends meeting on a long route', () => {
    expect(isLoop([{ x: 0, z: 0 }, { x: 500, z: 0 }, { x: 20, z: 10 }])).toBe(true)
    expect(isLoop([{ x: 0, z: 0 }, { x: 2000, z: 0 }])).toBe(false)
    expect(isLoop(points)).toBe(false) // 45 m end to end, but only 45 m long
  })

  it('keeps one point in three, and the end of an open road', () => {
    expect(roadLine(points, heights, false)).toEqual([
      [0, 100, 0],
      [15, 103, 0],
      [30, 106, 0],
      [45, 109, 0],
    ])
    expect(roadLine(points, heights, true)).toEqual([
      [0, 100, 0],
      [15, 103, 0],
      [30, 106, 0],
    ])
  })
})

describe('courseScript', () => {
  it('registers the course the way golden-hour-ride loads it', () => {
    const course = { name: 'Test', size: 20, cells: 2 } as Course
    const window: { RIDE_COURSES?: Record<string, Course> } = { RIDE_COURSES: { other: course } }
    new Function('window', courseScript('my-ride', course))(window)
    expect(window.RIDE_COURSES?.['my-ride']).toEqual(course)
    expect(window.RIDE_COURSES?.['other']).toBe(course)
  })
})

describe('mergeRevisits', () => {
  // Out along z = 0 for 1 km, round a turn, and back along z = 4: the same
  // road ridden twice, the return trace 4 m to the side as GPS leaves it.
  const out = Array.from({ length: 201 }, (_, k) => ({ x: k * 5, z: 0 }))
  const turn = Array.from({ length: 3 }, (_, k) => ({ x: 1000 + 2 * (k + 1), z: 1 + k }))
  const back = Array.from({ length: 201 }, (_, k) => ({ x: 1000 - k * 5, z: 4 }))
  const points = [...out, ...turn, ...back]
  const heights = points.map((p) => p.x / 100 + (p.z > 2 ? 0.3 : 0))

  it('lays the second pass onto the first', () => {
    const merged = mergeRevisits(points, heights, 5)
    expect(merged.shared).toBeGreaterThan(130)
    // well inside the return leg: on the outbound line, at its height
    const k = out.length + turn.length + 100
    expect(merged.points[k]!.z).toBeCloseTo(0, 6)
    expect(merged.points[k]!.x).toBeCloseTo(points[k]!.x, 6)
    expect(merged.heights[k]).toBeCloseTo(points[k]!.x / 100, 6)
  })

  it('leaves the first pass alone, and eases on and off rather than jumping', () => {
    const merged = mergeRevisits(points, heights, 5)
    merged.points.slice(0, out.length).forEach((p, k) => expect(p).toEqual(out[k]))
    for (let k = 1; k < merged.points.length; k++) {
      const sideways = Math.abs(merged.points[k]!.z - merged.points[k - 1]!.z)
      expect(sideways).toBeLessThan(1.5)
    }
  })

  it('ignores a road that crosses, and one that is merely nearby', () => {
    // East 1 km, north 500 m, west 500 m, then south across the first side at x = 500.
    const square = [
      ...Array.from({ length: 200 }, (_, k) => ({ x: k * 5, z: 0 })),
      ...Array.from({ length: 100 }, (_, k) => ({ x: 1000, z: k * 5 })),
      ...Array.from({ length: 100 }, (_, k) => ({ x: 1000 - k * 5, z: 500 })),
      ...Array.from({ length: 200 }, (_, k) => ({ x: 500, z: 500 - k * 5 })),
    ]
    const merged = mergeRevisits(square, square.map(() => 0), 5)
    expect(merged.shared).toBe(0)
    const parallel = [...out, ...Array.from({ length: 201 }, (_, k) => ({ x: 1000 - k * 5, z: 25 }))]
    expect(mergeRevisits(parallel, parallel.map(() => 0), 5).shared).toBe(0)
  })
})
