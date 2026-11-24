/**
 * The smallest TIFF reader that reads the Environment Agency's LiDAR tiles:
 * one image, uncompressed, one sample per pixel, 32-bit float or 16-bit
 * integer, in strips or tiles, either byte order. Anything else is refused
 * rather than misread.
 *
 * Follows golden-hour-ride's `read_tiff` in `tools/build_leckhampton.py`,
 * Copyright (c) 2026 Jamie Marsland, MIT licence (see LICENSE.golden-hour-ride).
 *
 * Pure. Georeferencing is left to the caller, who knows the window it asked for.
 */

import { GridFormatError, plausible } from './grid.ts'

export interface Raster {
  cols: number
  rows: number
  data: Float32Array
}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  sampleFormat: 339,
} as const

const SAMPLE_UINT = 1
const SAMPLE_INT = 2
const SAMPLE_FLOAT = 3

export function parseTiff(bytes: Uint8Array): Raster {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const order = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)
  if (order !== 'II' && order !== 'MM') {
    throw new GridFormatError(`Not a TIFF: ${new TextDecoder().decode(bytes.subarray(0, 200)).replace(/\s+/g, ' ')}`)
  }
  const little = order === 'II'
  const u16 = (offset: number) => view.getUint16(offset, little)
  const u32 = (offset: number) => view.getUint32(offset, little)
  if (u16(2) !== 42) throw new GridFormatError('Not a classic TIFF (BigTIFF is not supported).')

  const ifd = u32(4)
  const count = u16(ifd)
  const tags = new Map<number, number[]>()
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    const tag = u16(entry)
    const type = u16(entry + 2)
    const n = u32(entry + 4)
    if (type !== 3 && type !== 4) continue // only SHORT and LONG tags matter here
    const size = type === 3 ? 2 : 4
    const at = n * size <= 4 ? entry + 8 : u32(entry + 8)
    const values: number[] = []
    for (let k = 0; k < n; k++) values.push(size === 2 ? u16(at + k * 2) : u32(at + k * 4))
    tags.set(tag, values)
  }

  const first = (tag: number, fallback?: number): number => {
    const value = tags.get(tag)?.[0] ?? fallback
    if (value === undefined) throw new GridFormatError(`TIFF is missing tag ${tag}.`)
    return value
  }

  const cols = first(TAG.width)
  const rows = first(TAG.height)
  const bits = first(TAG.bitsPerSample)
  const format = first(TAG.sampleFormat, SAMPLE_UINT)
  if (first(TAG.compression, 1) !== 1) throw new GridFormatError('Compressed TIFF is not supported.')
  if (first(TAG.samplesPerPixel, 1) !== 1) throw new GridFormatError('TIFF has more than one sample per pixel.')

  const read = sampleReader(view, little, bits, format)
  const size = bits / 8
  const tiled = tags.has(TAG.tileOffsets)
  const blockWidth = tiled ? first(TAG.tileWidth) : cols
  const blockHeight = tiled ? first(TAG.tileLength) : first(TAG.rowsPerStrip, rows)
  const offsets = tags.get(tiled ? TAG.tileOffsets : TAG.stripOffsets)
  if (!offsets) throw new GridFormatError('TIFF has no image data offsets.')
  const across = Math.ceil(cols / blockWidth)

  const data = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x0 = 0; x0 < cols; x0 += blockWidth) {
      const block = Math.floor(y / blockHeight) * across + Math.floor(x0 / blockWidth)
      const offset = offsets[block]
      if (offset === undefined) throw new GridFormatError('TIFF image data is truncated.')
      const base = offset + (y % blockHeight) * blockWidth * size
      const run = Math.min(blockWidth, cols - x0)
      for (let k = 0; k < run; k++) data[y * cols + x0 + k] = plausible(read(base + k * size))
    }
  }
  return { cols, rows, data }
}

function sampleReader(view: DataView, little: boolean, bits: number, format: number): (offset: number) => number {
  if (bits === 32 && format === SAMPLE_FLOAT) return (o) => view.getFloat32(o, little)
  if (bits === 16 && format === SAMPLE_INT) return (o) => view.getInt16(o, little)
  if (bits === 16 && format === SAMPLE_UINT) return (o) => view.getUint16(o, little)
  if (bits === 32 && format === SAMPLE_INT) return (o) => view.getInt32(o, little)
  throw new GridFormatError(`TIFF samples of ${bits} bits, format ${format}, are not supported.`)
}
