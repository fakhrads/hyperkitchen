// erofs superblock fields needed to rebuild an image like the stock one.
// Layout: erofs-utils include/erofs_fs.h, struct erofs_super_block at offset 1024:
//   0 magic u32, 4 checksum u32, 8 feature_compat u32, 12 blkszbits u8, 13 sb_extslots u8,
//   14 root nid u16, 16 inos u64, 24 epoch u64, 32 fixed_nsec u32, 36 blocks_lo u32,
//   40 meta_blkaddr u32, 44 xattr_blkaddr u32, 48 uuid[16], 64 volume_name[16]

import { open } from 'node:fs/promises'
import { readExact } from './source'

const EROFS_SUPER_OFFSET = 1024
const EROFS_SUPER_MAGIC_V1 = 0xe0f5e1e2

export interface ErofsSuper {
  blockSize: number
  /** Build time in seconds; mkfs.erofs -T applies it to every inode by default (--all-time). */
  epoch: number
  uuid: string
  volumeName: string
}

export function parseErofsSuper(sb: Buffer): ErofsSuper {
  if (sb.readUInt32LE(0) !== EROFS_SUPER_MAGIC_V1) throw new Error('not an erofs image')
  const hex = sb.subarray(48, 64).toString('hex')
  const name = sb.subarray(64, 80)
  const z = name.indexOf(0)
  return {
    blockSize: 2 ** sb[12],
    epoch: Number(sb.readBigUInt64LE(24)),
    uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    volumeName: name.subarray(0, z < 0 ? 16 : z).toString('utf8')
  }
}

export async function readErofsSuper(path: string): Promise<ErofsSuper> {
  const fh = await open(path, 'r')
  try {
    return parseErofsSuper(await readExact(fh, EROFS_SUPER_OFFSET, 128))
  } finally {
    await fh.close()
  }
}
