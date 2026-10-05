// Inventory of an extracted partition tree: build.prop files and every APK with its package,
// version and signer. Pure TS so thousands of APKs take seconds, not one JVM per APK.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { ApkInfo, PropFile } from '../shared/types'
import { readManifest } from './formats/axml'
import { readSigner } from './formats/apksig'
import { BUILD_PROP_PATHS, parseProps, propMap } from './formats/buildprop'
import { ZipFile } from './formats/zip'
import { throwIfCancelled } from './context'

/** All regular files under dir matching pred, never following symlinks. */
export async function walkFiles(dir: string, pred: (name: string) => boolean): Promise<string[]> {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop() as string
    let ents
    try {
      ents = await readdir(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile() && pred(e.name)) out.push(p)
    }
  }
  return out.sort()
}

export async function readPartitionProps(partition: string, root: string): Promise<PropFile[]> {
  const out: PropFile[] = []
  for (const rel of BUILD_PROP_PATHS) {
    try {
      const text = await readFile(join(root, rel), 'utf8')
      out.push({ partition, path: rel, props: propMap(parseProps(text)) })
    } catch {
      /* not present in this partition */
    }
  }
  return out
}

export async function inspectApk(partition: string, root: string, file: string): Promise<ApkInfo> {
  const info: ApkInfo = {
    partition,
    path: relative(root, file),
    size: (await stat(file)).size,
    packageName: null,
    versionCode: null,
    versionName: null,
    sharedUserId: null,
    usesLibraries: [],
    overlayTarget: null,
    signerSha256: null,
    schemes: [],
    error: null
  }
  if (info.size === 0) {
    // Xiaomi ROMs contain 0-byte .apk placeholders; there is nothing to read.
    info.error = 'empty placeholder (0 bytes)'
    return info
  }
  let zip: ZipFile | null = null
  try {
    zip = await ZipFile.open(file)
    const manifest = await zip.read('AndroidManifest.xml')
    if (!manifest) throw new Error('no AndroidManifest.xml')
    Object.assign(info, readManifest(manifest))
    const signer = await readSigner(zip)
    info.signerSha256 = signer.certSha256
    info.schemes = signer.schemes
  } catch (e) {
    info.error = (e as Error).message
  } finally {
    await zip?.close()
  }
  return info
}

export async function inventoryApks(
  partitions: Array<{ name: string; root: string }>,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void
): Promise<ApkInfo[]> {
  const files: Array<{ partition: string; root: string; file: string }> = []
  for (const p of partitions) {
    for (const f of await walkFiles(p.root, (n) => n.endsWith('.apk'))) {
      files.push({ partition: p.name, root: p.root, file: f })
    }
  }
  const out: ApkInfo[] = new Array(files.length)
  let next = 0
  let done = 0
  // A few in flight hides file open latency on slow disks.
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      throwIfCancelled(signal)
      const i = next++
      const f = files[i]
      out[i] = await inspectApk(f.partition, f.root, f.file)
      onProgress(++done, files.length)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return out
}
