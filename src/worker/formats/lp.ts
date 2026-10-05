// Logical partition (super) metadata reader, replacing lpunpack which has no Darwin build.
// Format: AOSP system/core/fs_mgr/liblp/include/liblp/metadata_format.h, offsets from
// liblp/utility.cpp. All fields little endian, structs packed.
//
//   0            LP_PARTITION_RESERVED_BYTES (4096) reserved
//   4096         primary LpMetadataGeometry (padded to 4096)
//   8192         backup geometry
//   12288        primary metadata, one metadata_max_size slot per metadata_slot_count
//   ...          backup metadata slots

import { createHash } from 'node:crypto'
import type { BlockSource } from './source'

export const LP_SECTOR_SIZE = 512
const LP_PARTITION_RESERVED_BYTES = 4096
const LP_METADATA_GEOMETRY_SIZE = 4096
const LP_METADATA_GEOMETRY_MAGIC = 0x616c4467
const LP_METADATA_HEADER_MAGIC = 0x414c5030
const LP_METADATA_MAJOR_VERSION = 10
const LP_METADATA_MINOR_VERSION_MAX = 2
const LP_HEADER_V1_0_SIZE = 128

export const LP_PARTITION_ATTR_READONLY = 1 << 0
export const LP_PARTITION_ATTR_SLOT_SUFFIXED = 1 << 1
export const LP_HEADER_FLAG_VIRTUAL_AB_DEVICE = 0x1
export const LP_TARGET_TYPE_LINEAR = 0
export const LP_TARGET_TYPE_ZERO = 1

export interface LpGeometry {
  metadataMaxSize: number
  metadataSlotCount: number
  logicalBlockSize: number
}

export interface LpExtent {
  numSectors: number
  targetType: number
  targetData: number
  targetSource: number
}

export interface LpPartition {
  name: string
  attributes: number
  groupIndex: number
  groupName: string
  extents: LpExtent[]
  /** Sum of extent lengths in bytes. */
  size: number
}

export interface LpGroup {
  name: string
  flags: number
  maximumSize: number
}

export interface LpBlockDevice {
  firstLogicalSector: number
  alignment: number
  alignmentOffset: number
  size: number
  partitionName: string
  flags: number
}

export interface LpMetadata {
  geometry: LpGeometry
  major: number
  minor: number
  headerFlags: number
  partitions: LpPartition[]
  groups: LpGroup[]
  blockDevices: LpBlockDevice[]
}

function sha256(b: Buffer): Buffer {
  return createHash('sha256').update(b).digest()
}

function cstr(b: Buffer, off: number, len: number): string {
  const s = b.subarray(off, off + len)
  const z = s.indexOf(0)
  return s.subarray(0, z < 0 ? len : z).toString('ascii')
}

function u64(b: Buffer, off: number): number {
  const v = b.readBigUInt64LE(off)
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`64-bit value too large at ${off}`)
  return Number(v)
}

/** Parse and checksum-verify one geometry block. Returns null when the magic does not match. */
export function parseGeometry(b: Buffer): LpGeometry | null {
  if (b.readUInt32LE(0) !== LP_METADATA_GEOMETRY_MAGIC) return null
  const structSize = b.readUInt32LE(4)
  if (structSize < 52 || structSize > LP_METADATA_GEOMETRY_SIZE) {
    throw new Error(`bad lp geometry struct size ${structSize}`)
  }
  const copy = Buffer.from(b.subarray(0, structSize))
  const expected = Buffer.from(copy.subarray(8, 40))
  copy.fill(0, 8, 40)
  if (!sha256(copy).equals(expected)) throw new Error('lp geometry checksum mismatch')
  const g = {
    metadataMaxSize: b.readUInt32LE(40),
    metadataSlotCount: b.readUInt32LE(44),
    logicalBlockSize: b.readUInt32LE(48)
  }
  if (g.metadataMaxSize % LP_SECTOR_SIZE !== 0) throw new Error('bad lp metadata_max_size')
  if (g.metadataSlotCount === 0) throw new Error('lp metadata_slot_count is 0')
  if (g.logicalBlockSize === 0 || g.logicalBlockSize % LP_SECTOR_SIZE !== 0) {
    throw new Error('bad lp logical_block_size')
  }
  return g
}

interface TableDesc {
  offset: number
  numEntries: number
  entrySize: number
}

function desc(b: Buffer, off: number): TableDesc {
  return {
    offset: b.readUInt32LE(off),
    numEntries: b.readUInt32LE(off + 4),
    entrySize: b.readUInt32LE(off + 8)
  }
}

/** Parse and checksum-verify one metadata slot (header + tables). */
export function parseMetadata(b: Buffer, geometry: LpGeometry): LpMetadata {
  if (b.readUInt32LE(0) !== LP_METADATA_HEADER_MAGIC) throw new Error('bad lp metadata magic')
  const major = b.readUInt16LE(4)
  const minor = b.readUInt16LE(6)
  if (major !== LP_METADATA_MAJOR_VERSION || minor > LP_METADATA_MINOR_VERSION_MAX) {
    throw new Error(`unsupported lp metadata version ${major}.${minor}`)
  }
  const headerSize = b.readUInt32LE(8)
  if (headerSize < LP_HEADER_V1_0_SIZE || headerSize > b.length) {
    throw new Error(`bad lp header size ${headerSize}`)
  }
  const hdr = Buffer.from(b.subarray(0, headerSize))
  const hdrSum = Buffer.from(hdr.subarray(12, 44))
  hdr.fill(0, 12, 44)
  if (!sha256(hdr).equals(hdrSum)) throw new Error('lp metadata header checksum mismatch')
  const tablesSize = b.readUInt32LE(44)
  if (headerSize + tablesSize > b.length) throw new Error('lp tables run past metadata slot')
  const tables = b.subarray(headerSize, headerSize + tablesSize)
  if (!sha256(tables).equals(b.subarray(48, 80))) throw new Error('lp tables checksum mismatch')

  const pd = desc(b, 80)
  const ed = desc(b, 92)
  const gd = desc(b, 104)
  const bd = desc(b, 116)
  // Header v1.2 adds flags at 128; older headers are zero-extended.
  const headerFlags = headerSize >= 132 ? b.readUInt32LE(128) : 0

  const entry = (d: TableDesc, i: number, min: number): number => {
    if (d.entrySize < min) throw new Error('lp table entry too small')
    const off = d.offset + i * d.entrySize
    if (off + d.entrySize > tables.length) throw new Error('lp table entry out of range')
    return off
  }

  const groups: LpGroup[] = []
  for (let i = 0; i < gd.numEntries; i++) {
    const o = entry(gd, i, 48)
    groups.push({
      name: cstr(tables, o, 36),
      flags: tables.readUInt32LE(o + 36),
      maximumSize: u64(tables, o + 40)
    })
  }

  const extents: LpExtent[] = []
  for (let i = 0; i < ed.numEntries; i++) {
    const o = entry(ed, i, 24)
    extents.push({
      numSectors: u64(tables, o),
      targetType: tables.readUInt32LE(o + 8),
      targetData: u64(tables, o + 12),
      targetSource: tables.readUInt32LE(o + 20)
    })
  }

  const partitions: LpPartition[] = []
  for (let i = 0; i < pd.numEntries; i++) {
    const o = entry(pd, i, 52)
    const first = tables.readUInt32LE(o + 40)
    const num = tables.readUInt32LE(o + 44)
    if (first + num > extents.length) throw new Error('lp partition extents out of range')
    const groupIndex = tables.readUInt32LE(o + 48)
    const own = extents.slice(first, first + num)
    partitions.push({
      name: cstr(tables, o, 36),
      attributes: tables.readUInt32LE(o + 36),
      groupIndex,
      groupName: groups[groupIndex]?.name ?? '',
      extents: own,
      size: own.reduce((s, e) => s + e.numSectors * LP_SECTOR_SIZE, 0)
    })
  }

  const blockDevices: LpBlockDevice[] = []
  for (let i = 0; i < bd.numEntries; i++) {
    const o = entry(bd, i, 64)
    blockDevices.push({
      firstLogicalSector: u64(tables, o),
      alignment: tables.readUInt32LE(o + 8),
      alignmentOffset: tables.readUInt32LE(o + 12),
      size: u64(tables, o + 16),
      partitionName: cstr(tables, o + 24, 36),
      flags: tables.readUInt32LE(o + 60)
    })
  }

  return { geometry, major, minor, headerFlags, partitions, groups, blockDevices }
}

/** Read slot 0 metadata from a super image, falling back to the backup copies. */
export async function readLpMetadata(src: BlockSource): Promise<LpMetadata> {
  let geometry: LpGeometry | null = null
  const errors: string[] = []
  for (const off of [
    LP_PARTITION_RESERVED_BYTES,
    LP_PARTITION_RESERVED_BYTES + LP_METADATA_GEOMETRY_SIZE
  ]) {
    try {
      geometry = parseGeometry(await src.read(off, LP_METADATA_GEOMETRY_SIZE))
      if (geometry) break
      errors.push(`no lp geometry magic at ${off}`)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  if (!geometry) throw new Error(`not a super image: ${errors.join('; ')}`)
  const base = LP_PARTITION_RESERVED_BYTES + LP_METADATA_GEOMETRY_SIZE * 2
  const primary = base
  const backup = base + geometry.metadataMaxSize * geometry.metadataSlotCount
  for (const off of [primary, backup]) {
    try {
      return parseMetadata(await src.read(off, geometry.metadataMaxSize), geometry)
    } catch (e) {
      errors.push(`metadata at ${off}: ${(e as Error).message}`)
    }
  }
  throw new Error(`cannot read lp metadata: ${errors.join('; ')}`)
}
