// File-by-file comparison of two extracted trees: type, size, symlink target and content hash.
// Used to prove a rebuilt image holds exactly the tree it was built from.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { throwIfCancelled } from './context'

interface Entry {
  type: 'dir' | 'file' | 'symlink' | 'other'
  size: number
  target?: string
}

async function list(root: string): Promise<Map<string, Entry>> {
  const out = new Map<string, Entry>()
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop() as string
    for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      const p = join(root, r)
      if (e.isSymbolicLink()) out.set(r, { type: 'symlink', size: 0, target: await readlink(p) })
      else if (e.isDirectory()) {
        out.set(r, { type: 'dir', size: 0 })
        stack.push(r)
      } else if (e.isFile()) out.set(r, { type: 'file', size: (await lstat(p)).size })
      else out.set(r, { type: 'other', size: 0 })
    }
  }
  return out
}

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256')
  for await (const c of createReadStream(path, { highWaterMark: 1024 * 1024 }))
    h.update(c as Buffer)
  return h.digest('hex')
}

export interface TreeDiff {
  files: number
  bytes: number
  differences: string[]
}

const MAX_REPORTED = 50

export async function compareTrees(
  a: string,
  b: string,
  signal: AbortSignal,
  onProgress?: (doneBytes: number, totalBytes: number) => void
): Promise<TreeDiff> {
  const [la, lb] = await Promise.all([list(a), list(b)])
  let total = 0
  for (const e of la.values()) if (e.type === 'file') total += e.size
  const differences: string[] = []
  const report = (s: string): void => {
    if (differences.length < MAX_REPORTED) differences.push(s)
    else if (differences.length === MAX_REPORTED) differences.push('… more differences omitted')
  }
  for (const k of la.keys()) if (!lb.has(k)) report(`only in ${a}: ${k}`)
  for (const k of lb.keys()) if (!la.has(k)) report(`only in ${b}: ${k}`)
  let files = 0
  let bytes = 0
  for (const [k, ea] of la) {
    const eb = lb.get(k)
    if (!eb) continue
    throwIfCancelled(signal)
    if (ea.type !== eb.type) report(`${k}: ${ea.type} vs ${eb.type}`)
    else if (ea.type === 'symlink' && ea.target !== eb.target) {
      report(`${k}: symlink ${ea.target} vs ${eb.target}`)
    } else if (ea.type === 'file') {
      files++
      if (ea.size !== eb.size) report(`${k}: size ${ea.size} vs ${eb.size}`)
      else {
        const [ha, hb] = await Promise.all([sha256(join(a, k)), sha256(join(b, k))])
        if (ha !== hb) report(`${k}: content differs`)
        bytes += ea.size
        onProgress?.(bytes, total)
      }
    }
  }
  return { files, bytes, differences }
}

/** Compare two text files as sets of lines (fs_config and file_contexts order is not stable). */
export async function compareLineSets(a: string, b: string): Promise<string[]> {
  const [ta, tb] = await Promise.all([readFile(a, 'utf8'), readFile(b, 'utf8')])
  const sa = new Set(ta.split('\n').filter(Boolean))
  const sb = new Set(tb.split('\n').filter(Boolean))
  const out: string[] = []
  for (const l of sa) if (!sb.has(l)) out.push(`- ${l}`)
  for (const l of sb) if (!sa.has(l)) out.push(`+ ${l}`)
  return out.slice(0, MAX_REPORTED)
}
