import { describe, expect, it } from 'vitest'

import { buildGraph, DEFAULT_BUILD, lineLength, onewayForBikes, rideable, type BuildOptions, type OsmWay } from './graph'

// A local grid in metres, near Lluc.
const LAT0 = 39.82
const LON0 = 2.88
const point = (x: number, y: number) => ({ lat: LAT0 + y / 111195, lon: LON0 + x / (111195 * Math.cos((LAT0 * Math.PI) / 180)) })

let nextId = 1
/** A way through numbered nodes; `at` gives each node's position in metres. */
function way(nodes: number[], at: Record<number, [number, number]>, tags: Record<string, string> = {}): OsmWay {
  return { id: nextId++, tags: { highway: 'tertiary', ...tags }, nodes, geometry: nodes.map((n) => point(...at[n]!)) }
}

const KEEP_ALL: BuildOptions = { ...DEFAULT_BUILD, deadEndM: 0, minorDeadEndM: 0 }

describe('tags', () => {
  it('keeps rideable roads of the chosen classes only', () => {
    expect(rideable({ highway: 'secondary' }, DEFAULT_BUILD.classes)).toBe(true)
    expect(rideable({ highway: 'motorway' }, DEFAULT_BUILD.classes)).toBe(false)
    expect(rideable({ highway: 'secondary', bicycle: 'no' }, DEFAULT_BUILD.classes)).toBe(false)
    expect(rideable({ highway: 'unclassified', access: 'private' }, DEFAULT_BUILD.classes)).toBe(false)
    expect(rideable({ highway: 'unclassified', access: 'private', bicycle: 'yes' }, DEFAULT_BUILD.classes)).toBe(true)
  })

  it('reads one-way the way a bicycle sees it', () => {
    expect(onewayForBikes({ oneway: 'yes' })).toBe(1)
    expect(onewayForBikes({ oneway: '-1' })).toBe(-1)
    expect(onewayForBikes({ oneway: 'yes', 'oneway:bicycle': 'no' })).toBe(0)
    expect(onewayForBikes({ junction: 'roundabout' })).toBe(1)
    expect(onewayForBikes({})).toBe(0)
  })
})

describe('buildGraph', () => {
  const at: Record<number, [number, number]> = {
    1: [0, 0], 2: [1000, 0], 3: [2000, 0], 4: [1000, 1000], 5: [3000, 0], 6: [1000, 2000],
  }

  it('splits ways where they meet', () => {
    // a main road 1-2-3 and a side road 2-4
    const { graph } = buildGraph([way([1, 2, 3], at), way([2, 4], at)], KEEP_ALL)
    expect(graph.nodes).toHaveLength(4)
    expect(graph.edges).toHaveLength(3)
    for (const e of graph.edges) expect(lineLength(e.points)).toBeCloseTo(1000, -1)
  })

  it('joins roads that meet only each other, so every node is a choice', () => {
    // one road mapped as three ways end to end, with a side road at 2
    const { graph } = buildGraph([way([1, 2], at), way([2, 3], at), way([3, 5], at), way([2, 4], at)], KEEP_ALL)
    expect(graph.edges).toHaveLength(3)
    const long = graph.edges.find((e) => lineLength(e.points) > 1500)!
    expect(lineLength(long.points)).toBeCloseTo(2000, -1)
  })

  it('makes a roundabout one junction', () => {
    const ring: Record<number, [number, number]> = { 10: [1000, 15], 11: [1015, 0], 12: [1000, -15], 13: [985, 0] }
    const all = { ...at, ...ring, 7: [2000, 0] as [number, number], 8: [1000, -1000] as [number, number] }
    const ways = [
      way([10, 11, 12, 13, 10], all, { highway: 'tertiary', junction: 'roundabout' }),
      way([1, 13], all),
      way([11, 7], all),
      way([10, 4], all),
      way([12, 8], all),
    ]
    const { graph, report } = buildGraph(ways, KEEP_ALL)
    expect(report.roundabouts).toBe(1)
    const degree = new Map<number, number>()
    for (const e of graph.edges) for (const n of [e.a, e.b]) degree.set(n, (degree.get(n) ?? 0) + 1)
    expect([...degree.values()].sort()).toEqual([1, 1, 1, 1, 4])
  })

  it('merges junctions a few metres apart', () => {
    // a staggered crossroads: the side roads join the main road 10 m apart
    const tight: Record<number, [number, number]> = { ...at, 20: [1010, 0], 21: [1010, -1000] }
    const { graph, report } = buildGraph([way([1, 2, 20, 3], tight), way([2, 4], tight), way([20, 21], tight)], KEEP_ALL)
    expect(report.merged).toBe(1)
    expect(graph.nodes).toHaveLength(5) // 1, 3, 4, 21 and the merged junction
  })

  it('drops short dead ends and keeps long ones that lead somewhere worth riding', () => {
    const spurs: Record<number, [number, number]> = { ...at, 30: [1000, -200], 31: [2000, 3000], 32: [3000, -1000] }
    const ways = [
      way([1, 2, 3, 5], spurs, { highway: 'secondary' }),
      way([1, 4, 5], spurs, { highway: 'secondary' }), // a loop, so the main road is no dead end
      way([2, 30], spurs, { highway: 'tertiary' }), // 200 m: a cul-de-sac
      way([4, 31], spurs, { highway: 'tertiary' }), // 2.2 km tertiary: like the road down to Sa Calobra
      way([3, 32], spurs, { highway: 'unclassified' }), // 1.4 km of farm lane
    ]
    const { graph, report } = buildGraph(ways, DEFAULT_BUILD)
    expect(report.deadEndsDropped).toBe(2)
    const kept = graph.edges.map((e) => Math.round(lineLength(e.points) / 100) / 10).sort((a, b) => a - b)
    expect(kept).toContain(2.2)
    expect(kept).not.toContain(0.2)
    expect(kept).not.toContain(1.4)
  })

  it('keeps only the largest connected part', () => {
    const island: Record<number, [number, number]> = { ...at, 40: [9000, 9000], 41: [9100, 9000] }
    const { graph, report } = buildGraph([way([1, 2, 3], island), way([2, 4], island), way([40, 41], island)], KEEP_ALL)
    expect(report.componentsDropped).toBe(1)
    expect(graph.edges).toHaveLength(3)
  })

  it('keeps one-way roads one-way, in their direction of travel', () => {
    const { graph } = buildGraph([way([1, 2], at, { oneway: '-1' }), way([2, 3], at), way([2, 4], at)], KEEP_ALL)
    const oneway = graph.edges.find((e) => e.oneway)!
    // mapped 1 -> 2 with oneway=-1: ridden from 2 to 1
    expect(oneway.points[0]!.lon).toBeGreaterThan(oneway.points[oneway.points.length - 1]!.lon)
  })

  it('carries bridges and tunnels through a join, measured from the start', () => {
    // 2 -> 3 on the road, 3 -> 5 on a bridge: one section from the junction at 2, bridge in its second kilometre
    const { graph } = buildGraph([way([1, 2], at), way([2, 3], at), way([3, 5], at, { bridge: 'yes' }), way([2, 4], at)], KEEP_ALL)
    const bridged = graph.edges.find((e) => e.structures.length > 0)!
    expect(lineLength(bridged.points)).toBeCloseTo(2000, -1)
    const start = bridged.points[0]!.lon < bridged.points[bridged.points.length - 1]!.lon ? 0 : 1000
    expect(bridged.structures).toHaveLength(1)
    expect(bridged.structures[0]!.from).toBeCloseTo(1000 - start, -1)
    expect(bridged.structures[0]!.to).toBeCloseTo(2000 - start, -1)
  })

  it('ignores ways a bicycle may not use', () => {
    const { graph } = buildGraph([way([1, 2, 3], at), way([2, 4], at, { highway: 'motorway' })], KEEP_ALL)
    expect(graph.edges).toHaveLength(1)
  })
})
