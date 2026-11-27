import { deflateSync, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { readPbf, Reader, type PbfNode, type PbfWay } from './pbf'

// ---- a protobuf writer, just enough to build a file by hand
const varint = (n: number): number[] => {
  const out: number[] = []
  while (n >= 128) {
    out.push((n % 128) | 128)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
const zigzag = (n: number) => (n >= 0 ? 2 * n : -2 * n - 1)
const key = (field: number, wire: number) => varint(field * 8 + wire)
const bytes = (field: number, data: number[] | Uint8Array) => [...key(field, 2), ...varint(data.length), ...data]
const uint = (field: number, n: number) => [...key(field, 0), ...varint(n)]
const packed = (field: number, values: number[], signed = false) => bytes(field, values.flatMap((v) => varint(signed ? zigzag(v) : v)))
const text = (s: string) => [...new TextEncoder().encode(s)]

function fileOf(blocks: { type: string; data: number[]; compress?: boolean }[]): Uint8Array {
  const out: number[] = []
  for (const { type, data, compress } of blocks) {
    const blob = compress ? [...uint(2, data.length), ...bytes(3, deflateSync(Uint8Array.from(data)))] : bytes(1, data)
    const header = [...bytes(1, text(type)), ...uint(3, blob.length)]
    out.push((header.length >>> 24) & 255, (header.length >>> 16) & 255, (header.length >>> 8) & 255, header.length & 255, ...header, ...blob)
  }
  return Uint8Array.from(out)
}

// Sóller and the Coll de Sóller road: two tagged nodes and a way through them.
const strings = ['', 'place', 'town', 'name', 'Sóller', 'highway', 'secondary', 'ref', 'Ma-11']
const stringTable = bytes(1, strings.flatMap((s) => bytes(1, text(s))))
const raw = (deg: number) => Math.round(deg * 1e7) // granularity 100 nanodegrees
const dense = bytes(
  2,
  [
    ...packed(1, [5_000_000_001, 9], true), // ids 5000000001 and 5000000010, delta-coded, past 2^32
    ...packed(8, [raw(39.7667), raw(39.75) - raw(39.7667)], true),
    ...packed(9, [raw(2.7153), raw(2.7) - raw(2.7153)], true),
    ...packed(10, [1, 2, 3, 4, 0, 0]), // the first is a town called Sóller, the second has no tags
  ],
)
const wayMessage = [...uint(1, 77), ...packed(2, [5, 7]), ...packed(3, [6, 8]), ...packed(8, [5_000_000_010, -9], true)]
const block = [...stringTable, ...bytes(2, dense), ...bytes(2, bytes(3, wayMessage))]

describe('Reader', () => {
  it('reads varints past 2^32 and zigzag negatives', () => {
    const r = new Reader(Uint8Array.from([...varint(5_000_000_001), ...varint(zigzag(-3))]))
    expect(r.varint()).toBe(5_000_000_001)
    expect(r.svarint()).toBe(-3)
    expect(r.done).toBe(true)
  })
})

describe('readPbf', () => {
  for (const compress of [false, true]) {
    it(`reads dense nodes, tags and ways${compress ? ' from a zlib blob' : ''}`, () => {
      const nodes: PbfNode[] = []
      const ways: PbfWay[] = []
      const file = fileOf([
        { type: 'OSMHeader', data: [1, 2, 3] },
        { type: 'OSMData', data: block, compress },
      ])
      readPbf(file, { node: (n) => nodes.push(n), way: (w) => ways.push(w) }, (b) => new Uint8Array(inflateSync(b)))

      expect(nodes).toHaveLength(2)
      expect(nodes[0]).toMatchObject({ id: 5_000_000_001, tags: { place: 'town', name: 'Sóller' } })
      expect(nodes[0]!.lat).toBeCloseTo(39.7667, 7)
      expect(nodes[0]!.lon).toBeCloseTo(2.7153, 7)
      expect(nodes[1]).toMatchObject({ id: 5_000_000_010, tags: {} })
      expect(nodes[1]!.lat).toBeCloseTo(39.75, 7)

      expect(ways).toEqual([{ id: 77, refs: [5_000_000_010, 5_000_000_001], tags: { highway: 'secondary', ref: 'Ma-11' } }])
    })
  }
})
