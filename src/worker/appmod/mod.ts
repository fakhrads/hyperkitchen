// App mod workspace (see shared/appmod.ts for the layout) and its application at build time.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  DECODE_META,
  ModSchema,
  OverlaySchema,
  MOD_ID,
  type ModInfo,
  type ModSummary,
  type Overlay,
  type OverlayChange
} from '../../shared/appmod'
import { throwIfCancelled } from '../context'
import { readManifest } from '../formats/axml'
import { ZipFile } from '../formats/zip'
import { cloneTree } from '../fsutil'
import { ensureFrameworks } from './frameworks'
import { classify, decode, decodeArgs, rebuildDecoded, type ApktoolEnv } from './rebuild'

export interface ModEnv extends ApktoolEnv {
  projectPath: string
  log: (s: string) => void
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

export interface ModPaths {
  dir: string
  modFile: string
  overlayFile: string
  overlayDir: string
  base: string
  edit: string
  out: string
  frame: string
  stockFs: string
}

export function modPaths(projectPath: string, id: string): ModPaths {
  const dir = join(projectPath, 'mods', id)
  return {
    dir,
    modFile: join(dir, 'mod.json'),
    overlayFile: join(dir, 'overlay.json'),
    overlayDir: join(dir, 'overlay'),
    base: join(dir, 'cache', 'base'),
    edit: join(dir, 'cache', 'edit'),
    out: join(dir, 'out'),
    frame: join(projectPath, 'mods', '.frame'),
    stockFs: join(projectPath, 'stock', 'fs')
  }
}

export async function readMod(projectPath: string, id: string): Promise<ModInfo> {
  return ModSchema.parse(JSON.parse(await readFile(modPaths(projectPath, id).modFile, 'utf8')))
}

export async function readOverlay(projectPath: string, id: string): Promise<Overlay> {
  const f = modPaths(projectPath, id).overlayFile
  if (!existsSync(f)) return { schema: 1, changes: [] }
  return OverlaySchema.parse(JSON.parse(await readFile(f, 'utf8')))
}

export async function listMods(projectPath: string): Promise<ModSummary[]> {
  const root = join(projectPath, 'mods')
  if (!existsSync(root)) return []
  const out: ModSummary[] = []
  for (const id of (await readdir(root)).sort()) {
    if (!MOD_ID.test(id) || !existsSync(modPaths(projectPath, id).modFile)) continue
    out.push({
      mod: await readMod(projectPath, id),
      changes: (await readOverlay(projectPath, id)).changes,
      open: existsSync(modPaths(projectPath, id).edit)
    })
  }
  return out
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z0-9]+/, '')
      .slice(0, 60) || 'mod'
  )
}

export async function createMod(
  env: ModEnv,
  opts: { target: string; resources: boolean; note?: string }
): Promise<ModInfo> {
  const p0 = modPaths(env.projectPath, 'x')
  const file = join(p0.stockFs, opts.target)
  if (!/\.(apk|jar)$/.test(opts.target) || !existsSync(file))
    throw new Error(`${opts.target}: no such APK or jar in the stock tree`)
  const data = await readFile(file)
  let packageName: string | null = null
  if (opts.target.endsWith('.apk')) {
    const z = await ZipFile.open(file)
    try {
      const m = await z.read('AndroidManifest.xml')
      if (m) packageName = readManifest(m).packageName ?? null
    } finally {
      await z.close()
    }
  }
  const stem = slug(packageName ?? basename(opts.target).replace(/\.(apk|jar)$/, ''))
  let id = stem
  for (let i = 2; existsSync(modPaths(env.projectPath, id).dir); i++) id = `${stem}-${i}`
  const mod: ModInfo = ModSchema.parse({
    schema: 1,
    id,
    target: opts.target,
    packageName,
    sourceSha256: sha256(data),
    resources: opts.resources,
    note: opts.note ?? ''
  })
  const p = modPaths(env.projectPath, id)
  await mkdir(p.dir, { recursive: true })
  await writeFile(p.modFile, JSON.stringify(mod, null, 2))
  await writeFile(p.overlayFile, JSON.stringify({ schema: 1, changes: [] }, null, 2))
  return mod
}

async function argsFor(env: ModEnv, mod: ModInfo): Promise<string[]> {
  const p = modPaths(env.projectPath, mod.id)
  if (mod.resources)
    await ensureFrameworks({ env, stockFs: p.stockFs, frameDir: p.frame, log: env.log })
  return decodeArgs({ resources: mod.resources, assets: true }, mod.resources ? p.frame : undefined)
}

/** Decoded files relative to the decode root, without apktool's own files. */
async function listDecoded(root: string): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const out = new Map<string, { size: number; mtimeMs: number }>()
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop() as string
    for (const e of await readdir(join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (!rel && DECODE_META.has(e.name)) continue
      if (e.isDirectory()) stack.push(r)
      else if (e.isFile()) {
        const st = await lstat(join(root, r))
        out.set(r, { size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }
  return out
}

/** What differs between a pristine decode and an edited one. */
export async function diffDecoded(
  base: string,
  edit: string,
  signal: AbortSignal
): Promise<OverlayChange[]> {
  const [a, b] = await Promise.all([listDecoded(base), listDecoded(edit)])
  const changes: OverlayChange[] = []
  for (const [rel, sa] of a) {
    throwIfCancelled(signal)
    const sb = b.get(rel)
    const baseData = await (sb && sb.size === sa.size && sb.mtimeMs === sa.mtimeMs
      ? null
      : readFile(join(base, rel)))
    if (!sb) {
      changes.push({
        path: rel,
        kind: 'deleted',
        baseSha256: sha256(baseData as Buffer),
        sha256: null
      })
      continue
    }
    if (!baseData) continue // clone with the same size and time: untouched
    const editData = await readFile(join(edit, rel))
    if (!editData.equals(baseData)) {
      changes.push({
        path: rel,
        kind: 'modified',
        baseSha256: sha256(baseData),
        sha256: sha256(editData)
      })
    }
  }
  for (const rel of b.keys()) {
    if (a.has(rel)) continue
    changes.push({
      path: rel,
      kind: 'added',
      baseSha256: null,
      sha256: sha256(await readFile(join(edit, rel)))
    })
  }
  return changes.sort((x, y) => x.path.localeCompare(y.path))
}

/** Apply an overlay onto a fresh decode. Every edited file must still be the one it was made on. */
export async function applyOverlay(
  dec: string,
  overlayDir: string,
  changes: OverlayChange[]
): Promise<Array<{ path: string; data: Buffer | null }>> {
  const out: Array<{ path: string; data: Buffer | null }> = []
  for (const c of changes) {
    const target = join(dec, c.path)
    const exists = existsSync(target)
    if (c.kind === 'added') {
      if (exists) throw new Error(`${c.path}: added by the mod but already in the decode`)
    } else {
      if (!exists) throw new Error(`${c.path}: edited by the mod but missing from the decode`)
      if (sha256(await readFile(target)) !== c.baseSha256)
        throw new Error(`${c.path}: the file differs from the one the mod was made on`)
    }
    if (c.kind === 'deleted') {
      await rm(target)
      out.push({ path: c.path, data: null })
    } else {
      const data = await readFile(join(overlayDir, c.path))
      if (sha256(data) !== c.sha256) throw new Error(`${c.path}: overlay content is corrupt`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)
      out.push({ path: c.path, data })
    }
  }
  return out
}

/** Decode the stock file into cache/base and clone it to cache/edit with the overlay applied. */
export async function openMod(
  env: ModEnv,
  id: string,
  opts: { reset?: boolean } = {}
): Promise<{ mod: ModInfo; edit: string }> {
  const mod = await readMod(env.projectPath, id)
  const p = modPaths(env.projectPath, id)
  const stockFile = join(p.stockFs, mod.target)
  const stamp = join(p.base, '.hk-source')
  if (!existsSync(stamp) || (await readFile(stamp, 'utf8')) !== mod.sourceSha256) {
    if (sha256(await readFile(stockFile)) !== mod.sourceSha256)
      throw new Error(`${mod.target} in stock/ is not the file this mod was made on`)
    await rm(join(p.dir, 'cache'), { recursive: true, force: true })
    env.log(`decoding ${mod.target}${mod.resources ? ' with resources' : ''}`)
    await decode(env, stockFile, p.base, await argsFor(env, mod))
    await writeFile(stamp, mod.sourceSha256)
  }
  if (opts.reset) await rm(p.edit, { recursive: true, force: true })
  if (!existsSync(p.edit)) {
    await cloneTree(p.base, p.edit, env.signal)
    await rm(join(p.edit, '.hk-source'), { force: true })
    const overlay = await readOverlay(env.projectPath, id)
    await applyOverlay(p.edit, p.overlayDir, overlay.changes)
  }
  return { mod, edit: p.edit }
}

/** Record the working copy's edits as the mod's overlay. */
export async function saveMod(env: ModEnv, id: string): Promise<OverlayChange[]> {
  const p = modPaths(env.projectPath, id)
  if (!existsSync(p.edit)) throw new Error(`mod ${id} is not open`)
  const changes = await diffDecoded(p.base, p.edit, env.signal)
  // stamp file of base is not a decoded file
  const real = changes.filter((c) => c.path !== '.hk-source')
  const next = join(p.dir, 'overlay.next')
  await rm(next, { recursive: true, force: true })
  await mkdir(next, { recursive: true })
  for (const c of real) {
    if (c.kind === 'deleted') continue
    await mkdir(dirname(join(next, c.path)), { recursive: true })
    await writeFile(join(next, c.path), await readFile(join(p.edit, c.path)))
  }
  await rm(p.overlayDir, { recursive: true, force: true })
  await rename(next, p.overlayDir)
  await writeFile(p.overlayFile, JSON.stringify({ schema: 1, changes: real }, null, 2))
  return real
}

/**
 * Build the mod onto `src` (the file in work/ or stock/) into `out`: fresh decode, overlay,
 * rebuild with the gate of rebuild.ts.
 */
export async function buildMod(
  env: ModEnv,
  id: string,
  src: string,
  out: string,
  work: string
): Promise<{ replaced: string[]; added: number; removed: number; sameSource: boolean }> {
  const mod = await readMod(env.projectPath, id)
  const overlay = await readOverlay(env.projectPath, id)
  if (!overlay.changes.length) throw new Error(`mod ${id} has no changes`)
  const p = modPaths(env.projectPath, id)
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const dec = join(work, 'dec')
  const args = await argsFor(env, mod)
  await decode(env, src, dec, args)
  const applied = await applyOverlay(dec, p.overlayDir, overlay.changes)
  const changes = classify(applied, mod.resources)
  const r = await rebuildDecoded({
    env,
    orig: src,
    dec,
    args,
    changes,
    work,
    out,
    label: mod.target
  })
  await rm(dec, { recursive: true, force: true })
  return { ...r, sameSource: sha256(await readFile(src)) === mod.sourceSha256 }
}
