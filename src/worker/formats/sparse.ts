// Android sparse image reader (replaces simg2img, which has no Darwin build).
// Format: AOSP system/core/libsparse/sparse_format.h. All fields little endian.
//
//   sparse_header (file_hdr_sz bytes, 28 in v1.0)
//     u32 magic 0xed26ff3a, u16 major 1, u16 minor, u16 file_hdr_sz, u16 chunk_hdr_sz,
//     u32 blk_sz, u32 total_blks, u32 total_chunks, u32 image_checksum
//   chunk_header (chunk_hdr_sz bytes, 12 in v1.0)
//     u16 chunk_type, u16 reserved, u32 chunk_sz (output blocks), u32 total_sz (input bytes incl. header)
//
// A super image split for fastboot (super.img.0, super.img.1, ...) is a set of sparse files whose
// chunks mark the parts held by other files as DONT_CARE. Parts may describe different output
// sizes (seen in the wild: part N covers [0, end of its own data)), so the set's size is the
// largest one. SparseSource reads one or more such files as a single image.

import { open, type FileHandle } from 'node:fs/promises'
import { readExact, type BlockSource } from './source'

export const SPARSE_MAGIC = 0xed26ff3a
const CHUNK_RAW = 0xcac1
const CHUNK_FILL = 0xcac2
const CHUNK_DONT_CARE = 0xcac3
const CHUNK_CRC32 = 0xcac4

export interface SparseHeader {
  major: number
  minor: number
  fileHdrSz: number
  chunkHdrSz: number
  blkSz: number
  totalBlks: number
  totalChunks: number
}

export function parseSparseHeader(b: Buffer): SparseHeader | null {
  if (b.length < 28 || b.readUInt32LE(0) !== SPARSE_MAGIC) return null
  const h: SparseHeader = {
    major: b.readUInt16LE(4),
    minor: b.readUInt16LE(6),
    fileHdrSz: b.readUInt16LE(8),
    chunkHdrSz: b.readUInt16LE(10),
    blkSz: b.readUInt32LE(12),
    totalBlks: b.readUInt32LE(16),
    totalChunks: b.readUInt32LE(20)
  }
  if (h.major !== 1) throw new Error(`unsupported sparse major version ${h.major}`)
  if (h.fileHdrSz < 28 || h.chunkHdrSz < 12) throw new Error('sparse header sizes too small')
  if (h.blkSz === 0 || h.blkSz % 4 !== 0) throw new Error(`bad sparse block size ${h.blkSz}`)
  return h
}

export async function isSparseFile(path: string): Promise<boolean> {
  const fh = await open(path, 'r')
  try {
    const b = Buffer.alloc(28)
    const { bytesRead } = await fh.read(b, 0, 28, 0)
    return bytesRead === 28 && b.readUInt32LE(0) === SPARSE_MAGIC
  } finally {
    await fh.close()
  }
}

/** A run of output bytes backed by file data or a repeated 4-byte pattern. */
export interface SparseExtent {
  start: number
  len: number
  kind: 'raw' | 'fill'
  file: number
  fileOffset: number
  fill: number
}

async function scan(
  fh: FileHandle,
  fileIndex: number
): Promise<{ header: SparseHeader; extents: SparseExtent[] }> {
  const header = parseSparseHeader(await readExact(fh, 0, 28))
  if (!header) throw new Error('not a sparse image')
  const fileSize = (await fh.stat()).size
  const extents: SparseExtent[] = []
  let pos = header.fileHdrSz
  let block = 0
  for (let i = 0; i < header.totalChunks; i++) {
    const c = await readExact(fh, pos, 12)
    const type = c.readUInt16LE(0)
    const chunkSz = c.readUInt32LE(4)
    const totalSz = c.readUInt32LE(8)
    const dataPos = pos + header.chunkHdrSz
    const outLen = chunkSz * header.blkSz
    switch (type) {
      case CHUNK_RAW:
        if (totalSz !== header.chunkHdrSz + outLen) throw new Error(`chunk ${i}: bad raw size`)
        extents.push({
          start: block * header.blkSz,
          len: outLen,
          kind: 'raw',
          file: fileIndex,
          fileOffset: dataPos,
          fill: 0
        })
        break
      case CHUNK_FILL: {
        if (totalSz !== header.chunkHdrSz + 4) throw new Error(`chunk ${i}: bad fill size`)
        const fill = (await readExact(fh, dataPos, 4)).readUInt32LE(0)
        extents.push({
          start: block * header.blkSz,
          len: outLen,
          kind: 'fill',
          file: fileIndex,
          fileOffset: 0,
          fill
        })
        break
      }
      case CHUNK_DONT_CARE:
        break
      case CHUNK_CRC32:
        break
      default:
        throw new Error(`chunk ${i}: unknown chunk type 0x${type.toString(16)}`)
    }
    block += chunkSz
    pos += totalSz
    if (pos > fileSize) throw new Error(`chunk ${i} runs past end of file`)
  }
  if (block !== header.totalBlks) {
    throw new Error(`sparse chunks cover ${block} blocks, header says ${header.totalBlks}`)
  }
  return { header, extents }
}

export class SparseSource implements BlockSource {
  private constructor(
    private readonly files: FileHandle[],
    readonly extents: SparseExtent[],
    readonly size: number,
    readonly blockSize: number
  ) {}

  /** Open one sparse image, or a split set whose parts all describe the same output. */
  static async open(paths: string[]): Promise<SparseSource> {
    if (paths.length === 0) throw new Error('no sparse files given')
    const files: FileHandle[] = []
    try {
      let size = 0
      let blkSz = 0
      const all: SparseExtent[] = []
      for (const p of paths) {
        const fh = await open(p, 'r')
        files.push(fh)
        const { header, extents } = await scan(fh, files.length - 1)
        const s = header.totalBlks * header.blkSz
        if (blkSz && header.blkSz !== blkSz) {
          throw new Error(`${p}: block size differs from the other parts`)
        }
        size = Math.max(size, s)
        blkSz = header.blkSz
        all.push(...extents)
      }
      all.sort((a, b) => a.start - b.start)
      for (let i = 1; i < all.length; i++) {
        if (all[i].start < all[i - 1].start + all[i - 1].len) {
          throw new Error(`sparse parts overlap at byte ${all[i].start}`)
        }
      }
      return new SparseSource(files, all, size, blkSz)
    } catch (e) {
      await Promise.all(files.map((f) => f.close()))
      throw e
    }
  }

  /** Index of the last extent starting at or before pos, or -1. */
  private find(pos: number): number {
    let lo = 0
    let hi = this.extents.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.extents[mid].start <= pos) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans
  }

  async read(pos: number, len: number): Promise<Buffer> {
    const out = Buffer.alloc(len)
    const end = Math.min(pos + len, this.size)
    let i = this.find(pos)
    if (i < 0) i = 0
    for (; i < this.extents.length; i++) {
      const e = this.extents[i]
      if (e.start >= end) break
      const from = Math.max(pos, e.start)
      const to = Math.min(end, e.start + e.len)
      if (to <= from) continue
      if (e.kind === 'raw') {
        const b = await readExact(this.files[e.file], e.fileOffset + (from - e.start), to - from)
        b.copy(out, from - pos)
      } else if (e.fill !== 0) {
        const pattern = Buffer.alloc(4)
        pattern.writeUInt32LE(e.fill >>> 0)
        // Fill extents start on a block boundary, so the pattern phase is (from - e.start) % 4.
        const phase = (from - e.start) % 4
        for (let k = 0; k < to - from; k++) out[from - pos + k] = pattern[(phase + k) % 4]
      }
    }
    return out
  }

  async close(): Promise<void> {
    await Promise.all(this.files.map((f) => f.close()))
  }
}
