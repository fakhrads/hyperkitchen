// Minimal ZIP reader for APKs: central directory listing and reading single entries.
// Layout per PKWARE APPNOTE.TXT 4.3.7 (local header), 4.3.12 (central directory),
// 4.3.16 (end of central directory). Zip64 is not supported (APKs never need it).

import { createReadStream, createWriteStream } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw, crc32, inflateRawSync } from 'node:zlib'
import { readExact } from './source'

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff

export interface ZipEntry {
  name: string
  method: number
  /** CRC-32 of the uncompressed data (central directory). */
  crc?: number
  compressedSize: number
  size: number
  localHeaderOffset: number
}

export interface ZipIndex {
  entries: Map<string, ZipEntry>
  /** Offset of the central directory; the APK Signing Block, if any, ends right before it. */
  centralDirOffset: number
  fileSize: number
}

export class ZipFile {
  private constructor(
    private readonly fh: FileHandle,
    readonly index: ZipIndex,
    readonly path: string
  ) {}

  static async open(path: string): Promise<ZipFile> {
    const fh = await open(path, 'r')
    try {
      return new ZipFile(fh, await readIndex(fh), path)
    } catch (e) {
      await fh.close()
      throw e
    }
  }

  get entries(): Map<string, ZipEntry> {
    return this.index.entries
  }

  readRange(pos: number, len: number): Promise<Buffer> {
    return readExact(this.fh, pos, len)
  }

  async read(name: string, maxSize = 64 * 1024 * 1024): Promise<Buffer | null> {
    const e = this.index.entries.get(name)
    if (!e) return null
    if (e.size > maxSize) throw new Error(`${name}: ${e.size} bytes is larger than allowed`)
    const loc = await readExact(this.fh, e.localHeaderOffset, 30)
    if (loc.readUInt32LE(0) !== LOC_SIG) throw new Error(`${name}: bad local header`)
    const dataPos = e.localHeaderOffset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28)
    const raw = await readExact(this.fh, dataPos, e.compressedSize)
    if (e.method === 0) return raw
    if (e.method === 8) return inflateRawSync(raw)
    throw new Error(`${name}: unsupported compression method ${e.method}`)
  }

  /**
   * Stream one entry to a file without holding it in memory; checks the size and the CRC-32
   * from the central directory.
   */
  async extract(name: string, dest: string): Promise<void> {
    const e = this.index.entries.get(name)
    if (!e) throw new Error(`${name}: no such entry`)
    const loc = await readExact(this.fh, e.localHeaderOffset, 30)
    if (loc.readUInt32LE(0) !== LOC_SIG) throw new Error(`${name}: bad local header`)
    const dataPos = e.localHeaderOffset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28)
    if (e.method !== 0 && e.method !== 8)
      throw new Error(`${name}: unsupported compression method ${e.method}`)
    let crc = 0
    let size = 0
    const check = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        crc = crc32(chunk, crc)
        size += chunk.length
        cb(null, chunk)
      }
    })
    const out = createWriteStream(dest)
    if (e.compressedSize === 0) {
      await pipeline(Readable.from([]), check, out)
    } else {
      const src = createReadStream(this.path, {
        start: dataPos,
        end: dataPos + e.compressedSize - 1
      })
      if (e.method === 8) await pipeline(src, createInflateRaw(), check, out)
      else await pipeline(src, check, out)
    }
    if (size !== e.size) throw new Error(`${name}: ${size} bytes, expected ${e.size}`)
    if (e.crc !== undefined && crc >>> 0 !== e.crc >>> 0) throw new Error(`${name}: CRC mismatch`)
  }

  close(): Promise<void> {
    return this.fh.close()
  }
}

async function readIndex(fh: FileHandle): Promise<ZipIndex> {
  const fileSize = (await fh.stat()).size
  if (fileSize < EOCD_MIN) throw new Error('not a zip file (too small)')
  const tailLen = Math.min(fileSize, EOCD_MIN + MAX_COMMENT)
  const tail = await readExact(fh, fileSize - tailLen, tailLen)
  let eocd = -1
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (
      tail.readUInt32LE(i) === EOCD_SIG &&
      i + EOCD_MIN + tail.readUInt16LE(i + 20) <= tail.length
    ) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)')
  const total = tail.readUInt16LE(eocd + 10)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOffset = tail.readUInt32LE(eocd + 16)
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('zip64 archives are not supported')
  }
  if (cdOffset + cdSize > fileSize) throw new Error('central directory out of range')
  const cd = await readExact(fh, cdOffset, cdSize)
  const entries = new Map<string, ZipEntry>()
  let p = 0
  for (let i = 0; i < total; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN_SIG) {
      throw new Error(`bad central directory entry ${i}`)
    }
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    const flags = cd.readUInt16LE(p + 8)
    // Bit 11: file name is UTF-8.
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1')
    entries.set(name, {
      name,
      method: cd.readUInt16LE(p + 10),
      crc: cd.readUInt32LE(p + 16),
      compressedSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      localHeaderOffset: cd.readUInt32LE(p + 42)
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return { entries, centralDirOffset: cdOffset, fileSize }
}
