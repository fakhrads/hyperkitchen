// Identify what an image holds from its magic bytes.
// erofs: EROFS_SUPER_OFFSET 1024, EROFS_SUPER_MAGIC_V1 0xE0F5E1E2 (erofs-utils include/erofs_fs.h).
// ext4: superblock at 1024, s_magic at +0x38 equals 0xEF53 (linux fs/ext4/ext4.h, uapi magic.h).
// Android boot images start with "ANDROID!", vendor_boot with "VNDRBOOT", vbmeta with "AVB0".

import type { ImageKind } from '../../shared/types'
import type { BlockSource } from './source'
import { SPARSE_MAGIC } from './sparse'

const LP_GEOMETRY_MAGIC = 0x616c4467

export function detectKind(head: Buffer): ImageKind {
  if (head.length >= 4 && head.readUInt32LE(0) === SPARSE_MAGIC) return 'sparse'
  if (head.length >= 8 && head.subarray(0, 8).toString('latin1') === 'ANDROID!') return 'boot'
  if (head.length >= 8 && head.subarray(0, 8).toString('latin1') === 'VNDRBOOT')
    return 'vendor_boot'
  if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === 'AVB0') return 'vbmeta'
  if (head.length >= 1028 && head.readUInt32LE(1024) === 0xe0f5e1e2) return 'erofs'
  if (head.length >= 1024 + 0x3a && head.readUInt16LE(1024 + 0x38) === 0xef53) return 'ext4'
  if (head.length >= 4100 && head.readUInt32LE(4096) === LP_GEOMETRY_MAGIC) return 'super'
  if (head.every((b) => b === 0)) return 'empty'
  return 'unknown'
}

/** Bytes needed by detectKind. */
export const KIND_PROBE_BYTES = 8192

export async function detectSourceKind(src: BlockSource): Promise<ImageKind> {
  return detectKind(await src.read(0, Math.min(KIND_PROBE_BYTES, src.size)))
}
