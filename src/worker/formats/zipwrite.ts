// Rewrite a ZIP (APK or jar) replacing some entries, copying every other entry byte for byte.
//
// - Local records are written in their original order. Unchanged entries keep their local
//   header, extra field and compressed data; only offsets move.
// - Stored (uncompressed) entries keep the data alignment they had in the input (16 KiB, 4 KiB
//   or 4 bytes), re-padded when offsets move, using the same extra field as apksig
//   (ApkSigner.createExtraFieldToAlignData: header ID 0xd935, u16 alignment, zero padding).
//   resources.arsc and native libraries rely on this.
// - Replacement data is written with the original entry's compression method.
// - Entries can be removed, and new ones appended after the existing ones (stored entries
//   aligned like apksig/zipalign: 16 KiB for .so, 4 bytes otherwise), with a fixed DOS time so
//   the output is reproducible.
// - An APK Signing Block, if present, is copied unchanged right before the central directory,
//   as PureCN does. The signatures no longer match the content; Android does not verify APKs
//   on system partitions (InstallPackageHelper: skipVerify = scanSystemPartition) and only
//   reads the certificates.

import { open } from 'node:fs/promises'
import { crc32, deflateRawSync } from 'node:zlib'
import { readExact } from './source'

const LOC_SIG = 0x04034b50
const CEN_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const ALIGN_EXTRA_ID = 0xd935
const MAGIC = Buffer.from('APK Sig Block 42', 'latin1')

interface CenEntry {
  header: Buffer // full central directory record (46 + name + extra + comment)
  name: string
  method: number
  flags: number
  compressedSize: number
  localOffset: number
}

function parseCentral(cd: Buffer, count: number): CenEntry[] {
  const out: CenEntry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(p) !== CEN_SIG) throw new Error(`bad central directory entry ${i}`)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    const len = 46 + nameLen + extraLen + commentLen
    const flags = cd.readUInt16LE(p + 8)
    out.push({
      header: Buffer.from(cd.subarray(p, p + len)),
      name: cd.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1'),
      method: cd.readUInt16LE(p + 10),
      flags,
      compressedSize: cd.readUInt32LE(p + 20),
      localOffset: cd.readUInt32LE(p + 42)
    })
    p += len
  }
  return out
}

/** Extra field without alignment records, plus a fresh 0xd935 record when align > 1. */
export function alignedExtra(extra: Buffer, extraStart: number, align: number): Buffer {
  const kept: Buffer[] = []
  let o = 0
  while (o + 4 <= extra.length) {
    const id = extra.readUInt16LE(o)
    const size = extra.readUInt16LE(o + 2)
    if (o + 4 + size > extra.length) break
    if (!((id === 0 && size === 0) || id === ALIGN_EXTRA_ID))
      kept.push(extra.subarray(o, o + 4 + size))
    o += 4 + size
  }
  const base = Buffer.concat(kept)
  if (align <= 1) return base
  const minStart = extraStart + base.length + 6
  const pad = (align - (minStart % align)) % align
  const rec = Buffer.alloc(6 + pad)
  rec.writeUInt16LE(ALIGN_EXTRA_ID, 0)
  rec.writeUInt16LE(2 + pad, 2)
  rec.writeUInt16LE(align, 4)
  return Buffer.concat([base, rec])
}

/** The alignment a stored entry's data had in the input. */
function inputAlignment(dataOffset: number): number {
  for (const a of [16384, 4096, 4]) if (dataOffset % a === 0) return a
  return 1
}

export interface NewEntry {
  name: string
  data: Buffer
  /** Deflate the data (method 8) or store it (method 0). */
  compress: boolean
}

export interface RewriteOptions {
  /** Entries to drop. */
  remove?: (name: string) => boolean
  /** Entries written after the existing ones, in this order. */
  add?: NewEntry[]
}

/** DOS date 1981-01-01 00:00, the fixed timestamp aapt2 and apksigner use for new entries. */
const DOS_TIME = 0
const DOS_DATE = (1 << 5) | 1 | ((1981 - 1980) << 9)

function storedAlignment(name: string): number {
  return name.endsWith('.so') ? 16384 : 4
}

export async function rewriteZip(
  src: string,
  dst: string,
  replacements: Map<string, Buffer>,
  opts: RewriteOptions = {}
): Promise<void> {
  const fh = await open(src, 'r')
  try {
    const size = (await fh.stat()).size
    const tailLen = Math.min(size, 22 + 0xffff)
    const tail = await readExact(fh, size - tailLen, tailLen)
    let e = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG && i + 22 + tail.readUInt16LE(i + 20) <= tail.length) {
        e = i
        break
      }
    }
    if (e < 0) throw new Error(`${src}: not a zip file`)
    const eocd = Buffer.from(tail.subarray(e))
    const count = eocd.readUInt16LE(10)
    const cdSize = eocd.readUInt32LE(12)
    const cdOffset = eocd.readUInt32LE(16)
    if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 is not supported')
    const all = parseCentral(await readExact(fh, cdOffset, cdSize), count)
    const entries = opts.remove ? all.filter((x) => !opts.remove?.(x.name)) : all
    for (const name of replacements.keys()) {
      if (!entries.some((x) => x.name === name))
        throw new Error(`${src}: no entry ${name} to replace`)
    }
    const added = opts.add ?? []
    const names = new Set(entries.map((x) => x.name))
    for (const a of added) {
      if (names.has(a.name)) throw new Error(`${src}: entry ${a.name} already exists`)
      names.add(a.name)
    }
    if (names.size > 0xfffe) throw new Error('zip64 is not supported')

    // APK Signing Block, copied verbatim.
    let sigBlock: Buffer = Buffer.alloc(0)
    let sigBlockAlign = 1
    if (cdOffset >= 32) {
      const footer = await readExact(fh, cdOffset - 24, 24)
      if (footer.subarray(8).equals(MAGIC)) {
        const blockSize = Number(footer.readBigUInt64LE(0))
        const start = cdOffset - blockSize - 8
        sigBlock = await readExact(fh, start, blockSize + 8)
        // apksigner pads the entries with zeros so the block starts on a 4 KiB boundary
        // (ApkSigningBlockUtils checks this for APK verity); keep that.
        if (start % 4096 === 0) sigBlockAlign = 4096
      }
    }

    const order = [...entries].sort((a, b) => a.localOffset - b.localOffset)
    const out = await open(dst, 'w')
    try {
      let pos = 0
      const write = async (b: Buffer): Promise<void> => {
        await out.write(b, 0, b.length, pos)
        pos += b.length
      }
      const newOffset = new Map<CenEntry, number>()
      const newSizes = new Map<CenEntry, { crc: number; csize: number; usize: number }>()
      for (const ent of order) {
        const lh = await readExact(fh, ent.localOffset, 30)
        if (lh.readUInt32LE(0) !== LOC_SIG) throw new Error(`${ent.name}: bad local header`)
        const nameLen = lh.readUInt16LE(26)
        const extraLen = lh.readUInt16LE(28)
        const nameAndExtra = await readExact(fh, ent.localOffset + 30, nameLen + extraLen)
        const name = nameAndExtra.subarray(0, nameLen)
        const extra = nameAndExtra.subarray(nameLen)
        const dataStart = ent.localOffset + 30 + nameLen + extraLen
        const replacement = replacements.get(ent.name)
        let data: Buffer<ArrayBufferLike>
        let descriptor = Buffer.alloc(0)
        const header = Buffer.from(lh)
        if (replacement) {
          if (ent.method !== 0 && ent.method !== 8)
            throw new Error(`${ent.name}: unsupported method`)
          data = ent.method === 8 ? deflateRawSync(replacement) : replacement
          const crc = crc32(replacement) >>> 0
          header.writeUInt16LE(header.readUInt16LE(6) & ~0x8, 6) // sizes are in the header now
          header.writeUInt32LE(crc, 14)
          header.writeUInt32LE(data.length, 18)
          header.writeUInt32LE(replacement.length, 22)
          newSizes.set(ent, { crc, csize: data.length, usize: replacement.length })
        } else {
          data = await readExact(fh, dataStart, ent.compressedSize)
          if (ent.flags & 0x8) {
            // Data descriptor: optional signature, crc, csize, usize.
            const d = await readExact(fh, dataStart + ent.compressedSize, 16)
            descriptor = Buffer.from(d.subarray(0, d.readUInt32LE(0) === 0x08074b50 ? 16 : 12))
          }
        }
        let newExtra: Buffer = Buffer.from(extra)
        if (ent.method === 0) {
          const align = inputAlignment(dataStart)
          const extraStart = pos + 30 + nameLen
          if ((extraStart + extra.length) % align !== 0)
            newExtra = alignedExtra(extra, extraStart, align)
        }
        header.writeUInt16LE(newExtra.length, 28)
        newOffset.set(ent, pos)
        await write(header)
        await write(Buffer.from(name))
        await write(newExtra)
        await write(data)
        if (descriptor.length) await write(descriptor)
      }
      const addedCentral: Buffer[] = []
      for (const a of added) {
        const name = Buffer.from(a.name, 'utf8')
        const utf8 = name.length !== a.name.length ? 0x800 : 0
        const data = a.compress ? deflateRawSync(a.data) : a.data
        const crc = crc32(a.data) >>> 0
        const extra = a.compress
          ? Buffer.alloc(0)
          : alignedExtra(Buffer.alloc(0), pos + 30 + name.length, storedAlignment(a.name))
        const lh = Buffer.alloc(30)
        lh.writeUInt32LE(LOC_SIG, 0)
        lh.writeUInt16LE(a.compress ? 20 : 10, 4)
        lh.writeUInt16LE(utf8, 6)
        lh.writeUInt16LE(a.compress ? 8 : 0, 8)
        lh.writeUInt16LE(DOS_TIME, 10)
        lh.writeUInt16LE(DOS_DATE, 12)
        lh.writeUInt32LE(crc, 14)
        lh.writeUInt32LE(data.length, 18)
        lh.writeUInt32LE(a.data.length, 22)
        lh.writeUInt16LE(name.length, 26)
        lh.writeUInt16LE(extra.length, 28)
        const ch = Buffer.alloc(46)
        ch.writeUInt32LE(CEN_SIG, 0)
        ch.writeUInt16LE(a.compress ? 20 : 10, 4) // version made by: MS-DOS
        lh.copy(ch, 6, 4, 30) // version needed .. name length
        ch.writeUInt16LE(0, 30) // no extra in the central record
        ch.writeUInt32LE(pos, 42)
        addedCentral.push(Buffer.concat([ch, name]))
        await write(lh)
        await write(name)
        await write(extra)
        await write(data)
      }
      if (sigBlock.length && pos % sigBlockAlign !== 0) {
        await write(Buffer.alloc(sigBlockAlign - (pos % sigBlockAlign)))
      }
      await write(sigBlock)
      const cdStart = pos
      for (const ent of entries) {
        const h = Buffer.from(ent.header)
        h.writeUInt32LE(newOffset.get(ent) as number, 42)
        const ns = newSizes.get(ent)
        if (ns) {
          h.writeUInt16LE(h.readUInt16LE(8) & ~0x8, 8)
          h.writeUInt32LE(ns.crc, 16)
          h.writeUInt32LE(ns.csize, 20)
          h.writeUInt32LE(ns.usize, 24)
        }
        await write(h)
      }
      for (const h of addedCentral) await write(h)
      const newEocd = Buffer.from(eocd)
      newEocd.writeUInt16LE(names.size, 8)
      newEocd.writeUInt16LE(names.size, 10)
      newEocd.writeUInt32LE(pos - cdStart, 12)
      newEocd.writeUInt32LE(cdStart, 16)
      await write(newEocd)
    } finally {
      await out.close()
    }
  } finally {
    await fh.close()
  }
}

/**
 * A new zip with every entry stored (method 0), in the given order, fixed DOS time. Used for
 * bootanimation.zip, which BootAnimation.cpp refuses unless every entry is stored.
 */
export function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let pos = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const utf8 = name.length !== e.name.length ? 0x800 : 0
    const crc = crc32(e.data) >>> 0
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(LOC_SIG, 0)
    lh.writeUInt16LE(10, 4)
    lh.writeUInt16LE(utf8, 6)
    lh.writeUInt16LE(0, 8)
    lh.writeUInt16LE(DOS_TIME, 10)
    lh.writeUInt16LE(DOS_DATE, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(e.data.length, 18)
    lh.writeUInt32LE(e.data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(CEN_SIG, 0)
    ch.writeUInt16LE(10, 4)
    lh.copy(ch, 6, 4, 30)
    ch.writeUInt32LE(pos, 42)
    locals.push(lh, name, e.data)
    central.push(ch, name)
    pos += 30 + name.length + e.data.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(pos, 16)
  return Buffer.concat([...locals, cd, eocd])
}
