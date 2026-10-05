// Image type and size from the header, without decoding pixels.
//   PNG: signature, then the IHDR chunk (width, height as big-endian u32) - PNG spec 11.2.2.
//   JPEG: scan markers to the first SOFn (0xC0-0xCF except C4, C8, CC); height then width as
//         big-endian u16 after the precision byte - ITU T.81 B.2.2.
//   WebP: RIFF....WEBP with a VP8 / VP8L / VP8X chunk - RFC 9649.

export interface ImageInfo {
  type: 'png' | 'jpeg' | 'webp'
  width: number
  height: number
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function imageInfo(b: Buffer): ImageInfo | null {
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(PNG_SIG) &&
    b.toString('latin1', 12, 16) === 'IHDR'
  ) {
    return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null
      const m = b[i + 1]
      if (m === 0xff) {
        i++ // fill byte
        continue
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2
        continue
      }
      const len = b.readUInt16BE(i + 2)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        if (i + 9 > b.length) return null
        return { type: 'jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
    return null
  }
  if (
    b.length >= 30 &&
    b.toString('latin1', 0, 4) === 'RIFF' &&
    b.toString('latin1', 8, 12) === 'WEBP'
  ) {
    const chunk = b.toString('latin1', 12, 16)
    if (chunk === 'VP8 ' && b.length >= 30) {
      return {
        type: 'webp',
        width: b.readUInt16LE(26) & 0x3fff,
        height: b.readUInt16LE(28) & 0x3fff
      }
    }
    if (chunk === 'VP8L' && b.length >= 25) {
      const bits = b.readUInt32LE(21)
      return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X' && b.length >= 30) {
      return {
        type: 'webp',
        width: (b.readUIntLE(24, 3) & 0xffffff) + 1,
        height: (b.readUIntLE(27, 3) & 0xffffff) + 1
      }
    }
  }
  return null
}
