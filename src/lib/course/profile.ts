/**
 * The road's height profile from a terrain model.
 *
 * Pure. Works in the local frame (metres east and south) with whatever height
 * lookup it is handed, so it can be tested against invented ground.
 *
 * The method is golden-hour-ride's: sample across the road, take the flattest
 * spot, then smooth (`tools/build_leckhampton.py`, Copyright (c) 2026 Jamie
 * Marsland, MIT licence, see LICENSE.golden-hour-ride). Bridge and tunnel
 * repair is added here.
 */

import type { Local } from './geo.ts'

/** Spacing of the resampled road line. Matches golden-hour-ride. */
export const PROFILE_STEP_M = 5

/** How far either side of the line to look for the road surface. */
const SEARCH_HALF_WIDTH_M = 7
/** Half the baseline over which cross-slope is judged at each candidate. */
const CROSS_HALF_M = 1.5
/**
 * A small preference for the line itself, so that on genuinely flat ground
 * the search does not wander to its edge.
 */
const OFFSET_PENALTY = 0.02

/**
 * Steeper than this over a few metres is not a road. A terrain model has
 * bridges and tunnels taken out, so a bridge reads as a plunge into the gorge
 * below and a tunnel as a climb over the hill above; both break this limit
 * at their ends. The steepest paved climbs anywhere stay well under it.
 */
export const MAX_ROAD_GRADE = 0.3
/**
 * Bridges and tunnels are built gentle. The far end is looked for at this
 * average gradient first, so a wide, shallow gorge is spanned level rather
 * than descended into at the steepest believable slope.
 */
const BRIDGE_GRADE = 0.12
/** Longest gap to bridge. Beyond this a jump is left alone. */
const MAX_BRIDGE_M = 800
/** Straightening that moved the road by less than this is smoothing, not a bridge, and is not reported. */
const REPORT_DEVIATION_M = 2

export interface Resampled {
  points: Local[]
  /** Distance along the line of each point, metres. */
  distance: number[]
}

/** Points every `step` metres along a polyline, keeping the very end. */
export function resample(line: readonly Local[], step = PROFILE_STEP_M): Resampled {
  const first = line[0]
  if (!first) return { points: [], distance: [] }
  const points: Local[] = [first]
  const distance: number[] = [0]
  let walked = 0
  let next = step
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (length === 0) continue
    while (next <= walked + length) {
      const k = (next - walked) / length
      points.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k })
      distance.push(next)
      next += step
    }
    walked += length
  }
  const last = line[line.length - 1]!
  if (walked - distance[distance.length - 1]! > step / 10) {
    points.push(last)
    distance.push(walked)
  }
  return { points, distance }
}

/** Cumulative distance along a polyline in the local frame. */
export function cumulative(line: readonly Local[]): number[] {
  const out = [0]
  for (let i = 1; i < line.length; i++) {
    out.push(out[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.z - line[i - 1]!.z))
  }
  return out
}

/**
 * What moving the chosen spot one metre sideways between neighbouring points
 * costs, in the same units as cross-slope (metres of height across 3 m).
 *
 * Without it every point chooses alone, and in farmland the flattest spot
 * hops between the road and a field or ditch bed beside it, 3 to 5 m higher
 * or lower, and back again 30 m later. A road does not jump sideways, so the
 * spot may only drift.
 *
 * Measured on a 72 km ride across the Mallorcan plain, against the rider's
 * own altimeter: the gradient over 100 m agrees to 0.93 percentage points
 * (RMS) at anything from 0.2 to 1, against 0.94 choosing alone, because the
 * bridge repair was already catching the hops. What changes is the report:
 * stretches flagged as straightened fall from 15, none of them bridges, to 2.
 * 0.5 sits in the middle of that flat range.
 */
export const SHIFT_COST = 0.5

/**
 * Raw road height at each point: across the road, the spot where the ground
 * is flattest, along a path that only drifts sideways. A road is a level
 * shelf in a slope; the line from a GPS or a planner can sit a few metres
 * off it, on the bank or the drop. NaN where the terrain model has nothing.
 *
 * The path is the cheapest one through all the candidates at once (a Viterbi
 * search): each spot costs its cross-slope, each sideways step between
 * neighbours costs `shiftCost` per metre.
 */
export function roadHeights(
  points: readonly Local[],
  height: (x: number, z: number) => number,
  shiftCost = SHIFT_COST,
): number[] {
  const offsets: number[] = []
  for (let o = -SEARCH_HALF_WIDTH_M; o <= SEARCH_HALF_WIDTH_M; o++) offsets.push(o)
  const m = offsets.length
  const n = points.length
  const cost = new Float64Array(n * m)
  const value = new Float64Array(n * m)
  const empty = new Uint8Array(n)

  points.forEach((p, k) => {
    const a = points[Math.max(0, k - 1)]!
    const b = points[Math.min(n - 1, k + 1)]!
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
    // Perpendicular to the direction of travel
    const px = -(b.z - a.z) / length
    const pz = (b.x - a.x) / length
    const at = (o: number) => height(p.x + px * o, p.z + pz * o)
    let any = false
    offsets.forEach((offset, j) => {
      const before = at(offset - CROSS_HALF_M)
      const centre = at(offset)
      const after = at(offset + CROSS_HALF_M)
      const ok = !Number.isNaN(before) && !Number.isNaN(centre) && !Number.isNaN(after)
      cost[k * m + j] = ok ? Math.abs(after - before) + Math.abs(offset) * OFFSET_PENALTY : Number.POSITIVE_INFINITY
      value[k * m + j] = ok ? centre : Number.NaN
      any ||= ok
    })
    // No data anywhere across: let the path pass freely, and report NaN.
    if (!any) {
      empty[k] = 1
      cost.fill(0, k * m, (k + 1) * m)
    }
  })
  if (n === 0) return []

  // Forward pass: cheapest total cost of arriving at each offset.
  let total = Float64Array.from(cost.subarray(0, m))
  const from = new Uint8Array(n * m)
  for (let k = 1; k < n; k++) {
    const next = new Float64Array(m)
    for (let j = 0; j < m; j++) {
      let best = Number.POSITIVE_INFINITY
      let arg = j
      for (let i = 0; i < m; i++) {
        const c = total[i]! + shiftCost * Math.abs(offsets[i]! - offsets[j]!)
        if (c < best) {
          best = c
          arg = i
        }
      }
      next[j] = best + cost[k * m + j]!
      from[k * m + j] = arg
    }
    total = next
  }

  // Back along the cheapest path.
  let j = 0
  for (let i = 1; i < m; i++) if (total[i]! < total[j]!) j = i
  const out = new Array<number>(n)
  for (let k = n - 1; k >= 0; k--) {
    out[k] = empty[k] ? Number.NaN : value[k * m + j]!
    j = from[k * m + j]!
  }
  return out
}

/** Fills NaN from the nearest known neighbour before it, or after it at the start. */
export function fillGaps(values: readonly number[]): { values: number[]; missing: number } {
  const firstKnown = values.find((v) => !Number.isNaN(v))
  if (firstKnown === undefined) return { values: values.map(() => Number.NaN), missing: values.length }
  let carried = firstKnown
  let missing = 0
  const out = values.map((v) => {
    if (Number.isNaN(v)) {
      missing++
      return carried
    }
    carried = v
    return v
  })
  return { values: out, missing }
}

/** Running median over `2 * half + 1` points. Takes out single-cell spikes without rounding off climbs. */
export function median(values: readonly number[], half: number): number[] {
  return values.map((_, k) => {
    const window = values.slice(Math.max(0, k - half), k + half + 1).sort((p, q) => p - q)
    return window[Math.floor(window.length / 2)]!
  })
}

/** Running mean over `2 * half + 1` points. */
export function mean(values: readonly number[], half: number): number[] {
  return values.map((_, k) => {
    const window = values.slice(Math.max(0, k - half), k + half + 1)
    return window.reduce((sum, v) => sum + v, 0) / window.length
  })
}

export interface Bridged {
  values: number[]
  /** Index ranges that were replaced by a straight line, start and end kept. */
  spans: [number, number][]
}

/**
 * Straightens bridges and tunnels. Where the profile jumps more steeply than
 * any road climbs, look ahead for the first point that can be reached from
 * the last good one at a believable gradient, and lay a straight line
 * between them. A jump with no such point within reach is left as it is.
 */
export function bridgeGaps(values: readonly number[], step = PROFILE_STEP_M): Bridged {
  const out = values.slice()
  const spans: [number, number][] = []
  const steep = (k: number) => k + 1 < out.length && Math.abs(out[k + 1]! - out[k]!) > MAX_ROAD_GRADE * step
  // The far end must be reachable at `grade` and be road again: a point on
  // the gorge wall can be within reach and still lead straight back down.
  const landing = (from: number, grade: number): number => {
    for (let j = from + 2; j < out.length && (j - from) * step <= MAX_BRIDGE_M; j++) {
      if (Math.abs(out[j]! - out[from]!) <= grade * step * (j - from) && !steep(j) && !steep(j + 1)) return j
    }
    return -1
  }
  let i = 0
  while (i < out.length - 1) {
    if (Math.abs(out[i + 1]! - out[i]!) <= MAX_ROAD_GRADE * step) {
      i++
      continue
    }
    let end = landing(i, BRIDGE_GRADE)
    if (end < 0) end = landing(i, MAX_ROAD_GRADE)
    if (end < 0) {
      i++
      continue
    }
    for (let k = i + 1; k < end; k++) out[k] = out[i]! + ((out[end]! - out[i]!) * (k - i)) / (end - i)
    spans.push([i, end])
    i = end
  }
  return { values: out, spans }
}

export interface Profile {
  /** Smoothed road height at each resampled point. */
  heights: number[]
  /** Points where the terrain model had nothing and a neighbour stood in. */
  missing: number
  /** Stretches straightened as bridges or tunnels, in metres along the road. */
  bridged: { from: number; to: number }[]
}

/**
 * The whole chain: flattest spot across the road, a 25 m median, bridge and
 * tunnel repair, then two passes of a 35 m mean. The smoothing is
 * golden-hour-ride's; the app smooths again and measures gradient over 100 m
 * on top of it, so nothing here needs to be sharper than that.
 */
export function buildProfile(
  resampled: Resampled,
  height: (x: number, z: number) => number,
  step = PROFILE_STEP_M,
  structures: readonly Structure[] = [],
): Profile {
  const raw = roadHeights(resampled.points, height)
  const filled = fillGaps(raw)
  const steady = spanStructures(median(filled.values, 2), resampled.distance, structures)
  const bridged = bridgeGaps(steady, step)
  const heights = mean(mean(bridged.values, 3), 3)
  const moved = ([a, b]: [number, number]) => {
    let most = 0
    for (let k = a; k <= b; k++) most = Math.max(most, Math.abs(bridged.values[k]! - steady[k]!))
    return most
  }
  return {
    heights,
    missing: filled.missing,
    bridged: bridged.spans
      .filter((span) => moved(span) >= REPORT_DEVIATION_M)
      .map(([a, b]) => ({ from: resampled.distance[a]!, to: resampled.distance[b]! })),
  }
}

/** A stretch known to be a bridge or a tunnel, in metres along the road. */
export interface Structure {
  from: number
  to: number
}

/**
 * Where a map says the road is on a bridge or in a tunnel, the ground under it
 * says nothing about the road: lay a straight line from one end to the other.
 * The ends are taken a little outside the structure, where the road is back on
 * the ground. Better than finding them by their jumps, which misses a bridge
 * over a shallow dip and cannot tell a bridge from an embankment.
 */
export function spanStructures(values: readonly number[], distance: readonly number[], structures: readonly Structure[]): number[] {
  const out = values.slice()
  const margin = 2 * PROFILE_STEP_M
  for (const { from, to } of structures) {
    let a = 0
    while (a + 1 < distance.length && distance[a + 1]! <= from - margin) a++
    let b = distance.length - 1
    while (b - 1 >= 0 && distance[b - 1]! >= to + margin) b--
    if (b - a < 2) continue
    for (let k = a + 1; k < b; k++) out[k] = out[a]! + ((out[b]! - out[a]!) * (distance[k]! - distance[a]!)) / (distance[b]! - distance[a]!)
  }
  return out
}

/** Linear interpolation of a profile at arbitrary distances along the road. */
export function heightsAt(profile: { distance: readonly number[]; heights: readonly number[] }, at: readonly number[]): number[] {
  const { distance, heights } = profile
  let j = 0
  return at.map((d) => {
    while (j < distance.length - 2 && distance[j + 1]! < d) j++
    while (j > 0 && distance[j]! > d) j--
    const d0 = distance[j]!
    const d1 = distance[j + 1] ?? d0
    const k = d1 > d0 ? Math.max(0, Math.min(1, (d - d0) / (d1 - d0))) : 0
    return heights[j]! + ((heights[j + 1] ?? heights[j]!) - heights[j]!) * k
  })
}
