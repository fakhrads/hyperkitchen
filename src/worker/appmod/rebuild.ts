// Rebuild an APK or jar from an apktool-decoded tree, changing only what was edited.
//
// The original file is the base: rewriteZip keeps every other entry, the alignment and the
// original APK Signing Block (see formats/zipwrite.ts). What is taken from `apktool b`:
//   - classesN.dex for each smali directory that changed;
//   - when resources changed (full decode only): AndroidManifest.xml, resources.arsc and every
//     res/ entry. aapt2 renames obfuscated res/ paths, so the old res/ entries are all removed
//     and the rebuilt ones added (resources.arsc stored and 4-byte aligned).
// Raw files (assets/, lib/, unknown/ and, with -r, the undecoded res/ and manifest) are put in
// the zip as they are.
//
// Gate: the output is decoded again with the same frameworks and must reproduce the edited
// tree: smali per normalizeSmali, res/values*/*.xml as the same set of lines (aapt2 reorders
// enum and flag items), every other resource file and every raw entry byte for byte.

import { existsSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { ZipFile } from '../formats/zip'
import { rewriteZip, type NewEntry } from '../formats/zipwrite'
import { run } from '../spawn'

export interface ApktoolEnv {
  java: string
  apktool: string
  signal: AbortSignal
}

export interface DecodedChanges {
  /** Changed smali directories: smali, smali_classes2, ... */
  smaliDirs: Set<string>
  /** res/, resources.arsc or AndroidManifest.xml of a full decode changed. */
  resources: boolean
  /** Zip entry name -> new content, or null to remove the entry. */
  raw: Map<string, Buffer | null>
}

export async function apktool(env: ApktoolEnv, args: string[]): Promise<void> {
  const r = await run(env.java, ['-jar', env.apktool, ...args], { signal: env.signal })
  if (r.code !== 0) throw new Error(`apktool ${args[0]} failed: ${r.output.slice(-600)}`)
}

/**
 * apktool d arguments for a decode mode (apktool d --help): -r keeps resources undecoded,
 * --no-assets skips assets, -p is the framework directory.
 */
export function decodeArgs(
  mode: { resources: boolean; assets: boolean },
  frameDir?: string
): string[] {
  const a: string[] = []
  if (!mode.resources) a.push('-r')
  if (!mode.assets) a.push('--no-assets')
  if (frameDir) a.push('-p', frameDir)
  return a
}

export async function decode(
  env: ApktoolEnv,
  apk: string,
  out: string,
  args: string[]
): Promise<void> {
  await apktool(env, ['d', '-q', '-f', ...args, '-o', out, apk])
}

export async function smaliDirs(dec: string): Promise<string[]> {
  return (await readdir(dec)).filter((n) => /^smali(_classes\d+)?$/.test(n)).sort()
}

export const dexName = (smaliDir: string): string =>
  smaliDir === 'smali' ? 'classes.dex' : `${smaliDir.slice('smali_'.length)}.dex`

export async function walkFiles(
  dir: string,
  filter?: (name: string) => boolean
): Promise<string[]> {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkFiles(p, filter)))
    else if (e.isFile() && (!filter || filter(e.name))) out.push(p)
  }
  return out
}

/**
 * Smali compared line by line, ignoring blank lines, the alignment `nop` the assembler adds or
 * drops before a switch/array payload, and default static field values (not stored in dex).
 * Every other line must be identical.
 */
export function normalizeSmali(text: string): string {
  const lines = text
    .split('\n')
    .filter((l) => l.trim() !== '')
    // dex does not store static field values that equal the type's default.
    .map((l) =>
      /^\.field .*\bstatic\b/.test(l) ? l.replace(/ = (?:false|0x0L?|0|null|0\.0f?)$/, '') : l
    )
  return lines
    .filter(
      (l, i) =>
        !(
          l.trim() === 'nop' && /^\s*:(?:sswitch_data|pswitch_data|array)_/.test(lines[i + 1] ?? '')
        )
    )
    .join('\n')
}

/** The same lines in any order (values XML after aapt2 sorted enum/flag items). */
export function sameLineSet(a: string, b: string): boolean {
  const norm = (s: string): string =>
    s
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== '')
      .sort()
      .join('\n')
  return norm(a) === norm(b)
}

const PUBLIC_RE = /<public type="([^"]+)" name="([^"]+)" id="(0x[0-9a-f]+)"/g

/**
 * public.xml after a rebuild: every resource keeps its ID (other apps and the framework may
 * refer to them by number); aapt2 may only append IDs for resources the edit added. Returns a
 * description of the first violation, or null.
 */
export function publicIdChange(before: string, after: string): string | null {
  const ids = (s: string): Map<string, string> =>
    new Map([...s.matchAll(PUBLIC_RE)].map((m) => [`${m[1]}/${m[2]}`, m[3]]))
  const a = ids(before)
  const b = ids(after)
  for (const [k, id] of a) {
    if (b.get(k) !== id) return `${k} ${id} -> ${b.get(k) ?? 'missing'}`
  }
  const used = new Set(a.values())
  for (const [k, id] of b) {
    if (!a.has(k) && used.has(id)) return `${k} reuses ${id}`
  }
  return null
}

/** The zip entry a decoded file maps to, or null for apktool's own files. */
export function entryOf(rel: string, fullResources: boolean): string | null {
  const top = rel.split('/')[0]
  if (/^smali(_classes\d+)?$/.test(top)) return null
  if (['apktool.yml', 'original', 'build'].includes(top)) return null
  if (top === 'unknown') return rel.slice('unknown/'.length)
  if (fullResources && (top === 'res' || rel === 'AndroidManifest.xml')) return null
  return rel
}

/** What changed, from a list of decoded paths relative to the decode root. */
export function classify(
  paths: Array<{ path: string; data: Buffer | null }>,
  fullResources: boolean
): DecodedChanges {
  const c: DecodedChanges = { smaliDirs: new Set(), resources: false, raw: new Map() }
  for (const { path, data } of paths) {
    const top = path.split('/')[0]
    if (/^smali(_classes\d+)?$/.test(top)) c.smaliDirs.add(top)
    else if (fullResources && (top === 'res' || path === 'AndroidManifest.xml')) c.resources = true
    else {
      const entry = entryOf(path, fullResources)
      if (!entry) throw new Error(`${path}: apktool metadata cannot be changed`)
      c.raw.set(entry, data)
    }
  }
  return c
}

const RESOURCE_ENTRIES = (name: string): boolean =>
  name === 'AndroidManifest.xml' || name === 'resources.arsc' || name.startsWith('res/')

/**
 * Build `orig` with the edits in `dec` into `out`. `dec` is the decode of `orig` with
 * `args`, edited as described by `changes`. Throws if the gate finds any difference.
 */
export async function rebuildDecoded(opts: {
  env: ApktoolEnv
  orig: string
  dec: string
  args: string[]
  changes: DecodedChanges
  work: string
  out: string
  label: string
}): Promise<{ replaced: string[]; added: number; removed: number }> {
  const { env, changes, dec, label } = opts
  const frameIdx = opts.args.indexOf('-p')
  const frame = frameIdx >= 0 ? ['-p', opts.args[frameIdx + 1]] : []
  const replacements = new Map<string, Buffer>()
  const add: NewEntry[] = []
  const removeSet = new Set<string>()
  let removeRes = false

  if (changes.smaliDirs.size || changes.resources) {
    // apktool b -f builds everything without its change detection, -o output (apktool -advance).
    const built = join(opts.work, 'built.apk')
    await apktool(env, ['b', '-q', '-f', ...frame, '-o', built, dec])
    const zip = await ZipFile.open(built)
    try {
      for (const d of changes.smaliDirs) {
        const data = await zip.read(dexName(d), 1024 * 1024 * 1024)
        if (!data) throw new Error(`${label}: rebuilt file has no ${dexName(d)}`)
        replacements.set(dexName(d), data)
      }
      if (changes.resources) {
        removeRes = true
        for (const [name, e] of zip.entries) {
          if (!RESOURCE_ENTRIES(name)) continue
          const data = await zip.read(name, 1024 * 1024 * 1024)
          if (!data) continue
          // Android 11+ requires resources.arsc stored and aligned.
          add.push({ name, data, compress: name !== 'resources.arsc' && e.method === 8 })
        }
        add.sort((a, b) =>
          a.name === 'AndroidManifest.xml' ? -1 : b.name === 'AndroidManifest.xml' ? 1 : 0
        )
      }
    } finally {
      await zip.close()
    }
  }

  const orig = await ZipFile.open(opts.orig)
  try {
    for (const [name, data] of changes.raw) {
      if (data === null) {
        if (!orig.entries.has(name)) throw new Error(`${label}: no entry ${name} to remove`)
        removeSet.add(name)
      } else if (orig.entries.has(name) && !(removeRes && RESOURCE_ENTRIES(name))) {
        replacements.set(name, data)
      } else {
        const ref = [...orig.entries.values()].find((e) => e.name.startsWith(name.split('/')[0]))
        add.push({ name, data, compress: name.endsWith('.so') ? false : (ref?.method ?? 8) === 8 })
      }
    }
  } finally {
    await orig.close()
  }

  await rewriteZip(opts.orig, opts.out, replacements, {
    remove: (n) => removeSet.has(n) || (removeRes && RESOURCE_ENTRIES(n)),
    add
  })

  // Gate.
  const check = join(opts.work, 'check')
  await decode(env, opts.out, check, opts.args)
  for (const d of changes.smaliDirs) {
    const want = await walkFiles(join(dec, d), (n) => n.endsWith('.smali'))
    const got = new Set(await walkFiles(join(check, d), (n) => n.endsWith('.smali')))
    for (const f of want) {
      const g = join(check, relative(dec, f))
      if (!got.has(g)) throw new Error(`${label}: ${relative(dec, f)} missing after rebuild`)
      got.delete(g)
      const [a, b] = await Promise.all([readFile(f, 'utf8'), readFile(g, 'utf8')])
      if (normalizeSmali(a) !== normalizeSmali(b)) {
        throw new Error(
          `${label}: rebuilt dex does not match the edited smali in ${relative(dec, f)}`
        )
      }
    }
    if (got.size) throw new Error(`${label}: rebuild produced unexpected classes in ${d}`)
  }
  if (changes.resources) {
    const want = [...(await walkFiles(join(dec, 'res'))), join(dec, 'AndroidManifest.xml')].map(
      (f) => relative(dec, f)
    )
    const got = new Set(
      [...(await walkFiles(join(check, 'res'))), join(check, 'AndroidManifest.xml')].map((f) =>
        relative(check, f)
      )
    )
    for (const r of want) {
      if (!got.has(r)) throw new Error(`${label}: ${r} missing after rebuild`)
      got.delete(r)
      const [a, b] = await Promise.all([readFile(join(dec, r)), readFile(join(check, r))])
      if (a.equals(b)) continue
      if (r === 'res/values/public.xml') {
        const bad = publicIdChange(a.toString(), b.toString())
        if (!bad) continue
        throw new Error(`${label}: resource IDs changed: ${bad}`)
      }
      if (/^res\/values[^/]*\/[^/]+\.xml$/.test(r) && sameLineSet(a.toString(), b.toString()))
        continue
      throw new Error(`${label}: rebuilt resources differ from the edited ones in ${r}`)
    }
    if (got.size) throw new Error(`${label}: rebuild produced unexpected resources: ${[...got][0]}`)
  }
  if (changes.raw.size) {
    const z = await ZipFile.open(opts.out)
    try {
      for (const [name, data] of changes.raw) {
        const got = z.entries.has(name) ? await z.read(name, 1024 * 1024 * 1024) : null
        if (data === null ? got !== null : !got?.equals(data))
          throw new Error(`${label}: entry ${name} does not hold the edited content`)
      }
    } finally {
      await z.close()
    }
  }
  await rm(check, { recursive: true, force: true })
  return {
    replaced: [...replacements.keys()],
    added: add.length,
    removed: removeSet.size
  }
}
