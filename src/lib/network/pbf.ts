/**
 * The smallest reader of OpenStreetMap's PBF format that finds roads and
 * places: dense and plain nodes, and ways, with their tags. Relations are
 * skipped. Written by hand like the Zwift Click's messages, because a region
 * extract needs nothing more and a dependency would be the only one.
 *
 * Format: https://wiki.openstreetmap.org/wiki/PBF_Format. A file is a run of
 * blobs, each a 4-byte big-endian header length, a BlobHeader and a Blob; data
 * blobs hold a zlib-compressed PrimitiveBlock.
 *
 * Pure apart from decompression, which the caller supplies.
 */

export interface PbfNode {
  id: number
  lat: number
  lon: number
  tags: Record<string, string>
}

export interface PbfWay {
  id: number
  refs: number[]
  tags: Record<string, string>
}

export interface PbfVisitor {
  node?: (node: PbfNode) => void
  way?: (way: PbfWay) => void
}

export class PbfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PbfError'
  }
}

// ------------------------------------------------------------------ protobuf

/** A cursor over protobuf bytes. Integers past 2^32 are read as doubles, exact to 2^53: OSM ids fit. */
export class Reader {
  pos: number
  readonly end: number
  readonly bytes: Uint8Array

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes
    this.pos = start
    this.end = end
  }

  get done(): boolean {
    return this.pos >= this.end
  }

  varint(): number {
    let result = 0
    let scale = 1
    for (;;) {
      if (this.pos >= this.end) throw new PbfError('Truncated varint.')
      const byte = this.bytes[this.pos++]!
      result += (byte & 0x7f) * scale
      if (byte < 0x80) return result
      scale *= 128
    }
  }

  /** sint32 and sint64: zigzag. */
  svarint(): number {
    const n = this.varint()
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2
  }

  /** Field number and wire type. */
  tag(): [field: number, wire: number] {
    const t = this.varint()
    return [Math.floor(t / 8), t % 8]
  }

  /** A length-delimited field, as a reader over just its bytes. */
  sub(): Reader {
    const length = this.varint()
    const start = this.pos
    this.pos += length
    if (this.pos > this.end) throw new PbfError('Truncated field.')
    return new Reader(this.bytes, start, this.pos)
  }

  bytesField(): Uint8Array {
    const r = this.sub()
    return this.bytes.subarray(r.pos, r.end)
  }

  skip(wire: number): void {
    if (wire === 0) this.varint()
    else if (wire === 1) this.pos += 8
    else if (wire === 2) this.pos += this.varint()
    else if (wire === 5) this.pos += 4
    else throw new PbfError(`Wire type ${wire} is not one this reader knows.`)
  }

  /** A packed repeated varint field; `signed` for sint32/sint64. */
  packed(signed = false): number[] {
    const r = this.sub()
    const out: number[] = []
    while (!r.done) out.push(signed ? r.svarint() : r.varint())
    return out
  }
}

// ------------------------------------------------------------------ OSM

/** Walks every node and way in a PBF file. */
export function readPbf(file: Uint8Array, visitor: PbfVisitor, inflate: (compressed: Uint8Array) => Uint8Array): void {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  let pos = 0
  while (pos < file.length) {
    if (pos + 4 > file.length) throw new PbfError('Truncated blob header length.')
    const headerLength = view.getUint32(pos)
    pos += 4
    const header = new Reader(file, pos, pos + headerLength)
    pos += headerLength
    let type = ''
    let dataSize = 0
    while (!header.done) {
      const [field, wire] = header.tag()
      if (field === 1 && wire === 2) type = new TextDecoder().decode(header.bytesField())
      else if (field === 3 && wire === 0) dataSize = header.varint()
      else header.skip(wire)
    }
    const blob = new Reader(file, pos, pos + dataSize)
    pos += dataSize
    if (type !== 'OSMData') continue

    let data: Uint8Array | null = null
    while (!blob.done) {
      const [field, wire] = blob.tag()
      if (field === 1 && wire === 2) data = blob.bytesField()
      else if (field === 3 && wire === 2) data = inflate(blob.bytesField())
      else if (wire === 2 && (field === 4 || field === 5 || field === 6 || field === 7)) {
        throw new PbfError('Only raw and zlib-compressed blobs are supported.')
      } else blob.skip(wire)
    }
    if (data) readBlock(data, visitor)
  }
}

function readBlock(data: Uint8Array, visitor: PbfVisitor): void {
  const block = new Reader(data)
  const strings: string[] = []
  const groups: Reader[] = []
  let granularity = 100
  let latOffset = 0
  let lonOffset = 0
  const decoder = new TextDecoder()
  while (!block.done) {
    const [field, wire] = block.tag()
    if (field === 1 && wire === 2) {
      const table = block.sub()
      while (!table.done) {
        const [f, w] = table.tag()
        if (f === 1 && w === 2) strings.push(decoder.decode(table.bytesField()))
        else table.skip(w)
      }
    } else if (field === 2 && wire === 2) groups.push(block.sub())
    else if (field === 17 && wire === 0) granularity = block.varint()
    else if (field === 19 && wire === 0) latOffset = signed64(block.varint())
    else if (field === 20 && wire === 0) lonOffset = signed64(block.varint())
    else block.skip(wire)
  }
  const deg = (offset: number, raw: number) => (offset + granularity * raw) * 1e-9

  for (const group of groups) {
    while (!group.done) {
      const [field, wire] = group.tag()
      if (field === 1 && wire === 2 && visitor.node) readNode(group.sub(), strings, deg, latOffset, lonOffset, visitor.node)
      else if (field === 2 && wire === 2 && visitor.node) readDense(group.sub(), strings, deg, latOffset, lonOffset, visitor.node)
      else if (field === 3 && wire === 2 && visitor.way) readWay(group.sub(), strings, visitor.way)
      else group.skip(wire)
    }
  }
}

/** int64 fields arrive as two's complement varints: a negative offset reads as a huge number. */
function signed64(n: number): number {
  return n >= 2 ** 63 ? n - 2 ** 64 : n
}

type Deg = (offset: number, raw: number) => number

function readNode(r: Reader, strings: string[], deg: Deg, latOffset: number, lonOffset: number, emit: (n: PbfNode) => void): void {
  let id = 0
  let lat = 0
  let lon = 0
  let keys: number[] = []
  let vals: number[] = []
  while (!r.done) {
    const [field, wire] = r.tag()
    if (field === 1) id = r.svarint()
    else if (field === 2 && wire === 2) keys = r.packed()
    else if (field === 3 && wire === 2) vals = r.packed()
    else if (field === 8) lat = r.svarint()
    else if (field === 9) lon = r.svarint()
    else r.skip(wire)
  }
  const tags: Record<string, string> = {}
  keys.forEach((k, i) => (tags[strings[k]!] = strings[vals[i]!]!))
  emit({ id, lat: deg(latOffset, lat), lon: deg(lonOffset, lon), tags })
}

function readDense(r: Reader, strings: string[], deg: Deg, latOffset: number, lonOffset: number, emit: (n: PbfNode) => void): void {
  let ids: number[] = []
  let lats: number[] = []
  let lons: number[] = []
  let keysVals: number[] = []
  while (!r.done) {
    const [field, wire] = r.tag()
    if (field === 1 && wire === 2) ids = r.packed(true)
    else if (field === 8 && wire === 2) lats = r.packed(true)
    else if (field === 9 && wire === 2) lons = r.packed(true)
    else if (field === 10 && wire === 2) keysVals = r.packed()
    else r.skip(wire)
  }
  let id = 0
  let lat = 0
  let lon = 0
  let kv = 0
  for (let i = 0; i < ids.length; i++) {
    id += ids[i]!
    lat += lats[i]!
    lon += lons[i]!
    const tags: Record<string, string> = {}
    if (keysVals.length > 0) {
      while (kv < keysVals.length && keysVals[kv] !== 0) {
        tags[strings[keysVals[kv]!]!] = strings[keysVals[kv + 1]!]!
        kv += 2
      }
      kv++ // the 0 that ends this node's tags
    }
    emit({ id, lat: deg(latOffset, lat), lon: deg(lonOffset, lon), tags })
  }
}

function readWay(r: Reader, strings: string[], emit: (w: PbfWay) => void): void {
  let id = 0
  let keys: number[] = []
  let vals: number[] = []
  let deltas: number[] = []
  while (!r.done) {
    const [field, wire] = r.tag()
    if (field === 1 && wire === 0) id = r.varint()
    else if (field === 2 && wire === 2) keys = r.packed()
    else if (field === 3 && wire === 2) vals = r.packed()
    else if (field === 8 && wire === 2) deltas = r.packed(true)
    else r.skip(wire)
  }
  const refs: number[] = []
  let ref = 0
  for (const d of deltas) refs.push((ref += d))
  const tags: Record<string, string> = {}
  keys.forEach((k, i) => (tags[strings[k]!] = strings[vals[i]!]!))
  emit({ id, refs, tags })
}
