// vbmeta header flags. AOSP external/avb/libavb/avb_vbmeta_image.h, AvbVBMetaImageHeader:
// "AVB0" magic at 0, integers big endian, u32 flags at offset 120.
// AVB_VBMETA_IMAGE_FLAGS_HASHTREE_DISABLED = 1, AVB_VBMETA_IMAGE_FLAGS_VERIFICATION_DISABLED = 2.
// Setting both is what `fastboot --disable-verity --disable-verification flash vbmeta` does.
// The header is covered by the vbmeta signature, so the result only boots on an unlocked
// bootloader (libavb then tolerates the verification error).

export const AVB_FLAG_HASHTREE_DISABLED = 1
export const AVB_FLAG_VERIFICATION_DISABLED = 2
const FLAGS_OFFSET = 120

function check(b: Buffer): void {
  if (b.length < 256 || b.subarray(0, 4).toString('latin1') !== 'AVB0') {
    throw new Error('not a vbmeta image (no AVB0 header)')
  }
}

export function vbmetaFlags(b: Buffer): number {
  check(b)
  return b.readUInt32BE(FLAGS_OFFSET)
}

/** Returns a copy with the given flags set (OR-ed in). */
export function withVbmetaFlags(b: Buffer, flags: number): Buffer {
  check(b)
  const out = Buffer.from(b)
  out.writeUInt32BE((out.readUInt32BE(FLAGS_OFFSET) | flags) >>> 0, FLAGS_OFFSET)
  return out
}
