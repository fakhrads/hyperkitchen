// Framework resources an app's resources refer to, installed for apktool per project.
//
// Every resource package with an ID other than 0x7f (the app itself) and 0x00 (a shared
// library) is a provider other APKs can reference: framework-res (0x01), framework-ext-res
// (0x11), and on HyperOS also miuisystem (0x12), miuix (0x66) and others. The package ID is the
// `id` of the first ResTable_package chunk in resources.arsc (ResourceTypes.h). They are
// installed with `apktool if -p <dir>`, which names them <id>.apk.

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { throwIfCancelled } from '../context'
import { ZipFile } from '../formats/zip'
import { apktool, type ApktoolEnv } from './rebuild'

const RES_TABLE_PACKAGE = 0x0200

/** Package IDs declared in resources.arsc. */
export function arscPackageIds(arsc: Buffer): number[] {
  const ids: number[] = []
  if (arsc.length < 12 || arsc.readUInt16LE(0) !== 0x0002) return ids
  let p = arsc.readUInt16LE(2)
  while (p + 12 <= arsc.length) {
    const type = arsc.readUInt16LE(p)
    const size = arsc.readUInt32LE(p + 4)
    if (size < 8) break
    if (type === RES_TABLE_PACKAGE) ids.push(arsc.readUInt32LE(p + 8))
    p += size
  }
  return ids
}

async function packageIdOf(apk: string): Promise<number | null> {
  const z = await ZipFile.open(apk)
  try {
    const e = z.entries.get('resources.arsc')
    if (!e) return null
    if (e.method === 0) {
      // Stored: read only the chunk headers instead of the whole table.
      const loc = await z.readRange(e.localHeaderOffset, 30)
      const data = e.localHeaderOffset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28)
      const head = await z.readRange(data, 12)
      let p = head.readUInt16LE(2)
      while (p + 12 <= e.size) {
        const c = await z.readRange(data + p, 12)
        if (c.readUInt16LE(0) === RES_TABLE_PACKAGE) return c.readUInt32LE(8)
        p += c.readUInt32LE(4) || e.size
      }
      return null
    }
    return arscPackageIds((await z.read('resources.arsc', 512 * 1024 * 1024)) as Buffer)[0] ?? null
  } finally {
    await z.close()
  }
}

async function apksUnder(root: string, dir = ''): Promise<string[]> {
  const out: string[] = []
  let ents
  try {
    ents = await readdir(join(root, dir), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await apksUnder(root, rel)))
    else if (e.isFile() && e.name.endsWith('.apk')) out.push(rel)
  }
  return out
}

export interface FrameworkIndex {
  schema: 1
  /** Tree paths of the installed providers by package ID. */
  installed: Array<{ id: number; path: string }>
}

const rank = (p: string): number => (p.includes('/framework/') ? 0 : 1)

/**
 * Install every resource provider of the stock tree into frameDir (once; the index file
 * records what was installed).
 */
export async function ensureFrameworks(opts: {
  env: ApktoolEnv
  stockFs: string
  frameDir: string
  log: (s: string) => void
}): Promise<FrameworkIndex> {
  const indexFile = join(opts.frameDir, 'index.json')
  if (existsSync(indexFile)) {
    const idx = JSON.parse(await readFile(indexFile, 'utf8')) as FrameworkIndex
    if (idx.installed.every((x) => existsSync(join(opts.frameDir, `${x.id}.apk`)))) return idx
  }
  await rm(opts.frameDir, { recursive: true, force: true })
  await mkdir(opts.frameDir, { recursive: true })
  const byId = new Map<number, string>()
  for (const rel of await apksUnder(opts.stockFs)) {
    throwIfCancelled(opts.env.signal)
    let id: number | null = null
    try {
      id = await packageIdOf(join(opts.stockFs, rel))
    } catch {
      continue // placeholders and broken files are not providers
    }
    if (id === null || id === 0 || id === 0x7f) continue
    const prev = byId.get(id)
    if (!prev || rank(rel) < rank(prev)) byId.set(id, rel)
  }
  const installed: FrameworkIndex['installed'] = []
  for (const [id, rel] of [...byId].sort((a, b) => a[0] - b[0])) {
    // apktool if -p <dir> <apk> (apktool -advance).
    await apktool(opts.env, ['if', '-p', opts.frameDir, join(opts.stockFs, rel)])
    if (!existsSync(join(opts.frameDir, `${id}.apk`)))
      throw new Error(`apktool did not install ${rel} as ${id}.apk`)
    installed.push({ id, path: rel })
    opts.log(`framework 0x${id.toString(16)}: ${rel}`)
  }
  const idx: FrameworkIndex = { schema: 1, installed }
  await writeFile(indexFile, JSON.stringify(idx, null, 2))
  return idx
}
