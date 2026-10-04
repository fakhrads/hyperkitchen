import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { CancelledError } from './context'

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (received: number, total: number | null) => void
}

/**
 * Download url to dest, verifying sha256 before the file appears at dest.
 * The partial file lives at dest + '.part' and is removed on any failure.
 */
export async function downloadVerified(
  url: string,
  dest: string,
  sha256: string,
  opts: DownloadOptions = {}
): Promise<void> {
  const part = dest + '.part'
  try {
    const res = await fetch(url, { signal: opts.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
    const lenHeader = res.headers.get('content-length')
    const total = lenHeader ? Number(lenHeader) : null
    const hash = createHash('sha256')
    let received = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length
        hash.update(chunk)
        opts.onProgress?.(received, total)
        cb(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(part))
    const got = hash.digest('hex')
    if (got !== sha256.toLowerCase()) {
      throw new Error(`sha256 mismatch for ${url}: expected ${sha256}, got ${got}`)
    }
    await rename(part, dest)
  } catch (e) {
    await rm(part, { force: true })
    if (opts.signal?.aborted) throw new CancelledError()
    throw e
  }
}
