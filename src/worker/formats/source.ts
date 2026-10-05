import { open, type FileHandle } from 'node:fs/promises'
import { CancelledError } from '../context'

/** Random-access, read-only view of a disk image, whatever its container format. */
export interface BlockSource {
  readonly size: number
  /** Read len bytes at pos. Bytes past the end read as zero. */
  read(pos: number, len: number): Promise<Buffer>
  close(): Promise<void>
}

/** Read exactly len bytes at pos, failing on a short read. */
export async function readExact(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len)
  let done = 0
  while (done < len) {
    const { bytesRead } = await fh.read(buf, done, len - done, pos + done)
    if (bytesRead === 0) throw new Error(`unexpected end of file at ${pos + done}`)
    done += bytesRead
  }
  return buf
}

const COPY_CHUNK = 4 * 1024 * 1024

function isZero(b: Buffer): boolean {
  // Compare 8 bytes at a time; buffers here are always multiples of 8.
  for (let i = 0; i + 8 <= b.length; i += 8) if (b.readBigUInt64LE(i) !== 0n) return false
  for (let i = b.length - (b.length % 8); i < b.length; i++) if (b[i] !== 0) return false
  return true
}

/**
 * Copy ranges of a source into a new file of the given size. All-zero chunks are not written,
 * so the output stays sparse on filesystems that support holes (APFS, ext4, btrfs).
 */
export async function writeImage(
  src: BlockSource,
  outPath: string,
  size: number,
  ranges: Array<{ srcPos: number; outPos: number; len: number }>,
  onBytes?: (n: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const fh = await open(outPath, 'w')
  try {
    await fh.truncate(size)
    for (const r of ranges) {
      for (let done = 0; done < r.len; done += COPY_CHUNK) {
        if (signal?.aborted) throw new CancelledError()
        const n = Math.min(COPY_CHUNK, r.len - done)
        const buf = await src.read(r.srcPos + done, n)
        if (!isZero(buf)) await fh.write(buf, 0, n, r.outPos + done)
        onBytes?.(n)
      }
    }
  } finally {
    await fh.close()
  }
}

export class RawFileSource implements BlockSource {
  private constructor(
    private readonly fh: FileHandle,
    readonly size: number
  ) {}

  static async open(path: string): Promise<RawFileSource> {
    const fh = await open(path, 'r')
    return new RawFileSource(fh, (await fh.stat()).size)
  }

  async read(pos: number, len: number): Promise<Buffer> {
    const out = Buffer.alloc(len)
    const n = Math.max(0, Math.min(len, this.size - pos))
    if (n > 0) (await readExact(this.fh, pos, n)).copy(out)
    return out
  }

  close(): Promise<void> {
    return this.fh.close()
  }
}
