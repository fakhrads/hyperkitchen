// Small filesystem helpers shared by the unpack and build jobs.

import { createHash } from 'node:crypto'
import { constants as fsc, createReadStream } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { throwIfCancelled } from './context'
import { run } from './spawn'

/** Hash a file in the background. The promise never rejects unobserved: await it later. */
export function hashInBackground(path: string, signal: AbortSignal): Promise<string> {
  const p = hashFile(path, signal)
  p.catch(() => {})
  return p
}

export async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    throwIfCancelled(signal)
    h.update(chunk as Buffer)
  }
  return h.digest('hex')
}

/** Clone when the filesystem can (APFS via cp -c, btrfs/xfs via FICLONE), else copy. */
export async function cloneOrCopy(src: string, dst: string): Promise<void> {
  if (process.platform === 'darwin') {
    // cp -c uses clonefile(2) and falls back to a normal copy across volumes (man cp).
    const r = await run('cp', ['-c', src, dst])
    if (r.code !== 0) throw new Error(`cp -c ${src}: ${r.output.trim()}`)
  } else {
    await copyFile(src, dst, fsc.COPYFILE_FICLONE)
  }
}

/** Recursive clone of a directory tree, preserving symlinks and modes. */
export async function cloneTree(src: string, dst: string, signal?: AbortSignal): Promise<void> {
  // macOS: cp -a (= -RpP, symlinks copied as links) with -c to clone through clonefile(2),
  // falling back to a copy across volumes (man cp). GNU cp: -a archive, --reflink=auto clones
  // where the filesystem supports it.
  const args =
    process.platform === 'darwin' ? ['-c', '-a', src, dst] : ['-a', '--reflink=auto', src, dst]
  const r = await run('cp', args, { signal })
  if (r.code !== 0) throw new Error(`cp ${args.join(' ')}: ${r.output.trim().slice(0, 300)}`)
}
