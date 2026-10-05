// Applies smali patch sets to jars and APKs in work/fs.
//
// Per target file: apktool decode (no resources), edit smali with rules that must match an
// exact number of times, apktool build, take only the classesN.dex files whose smali changed,
// and rewrite the original zip with them (every other entry, the alignment and the original
// signing block are kept; see formats/zipwrite.ts). The new dex files are decoded again and
// must reproduce the edited smali exactly. Stale ART artifacts (odex/vdex/art) and fs-verity
// metadata (.fsv_meta) of the patched file are removed, so ART loads the new dex.
//
// Boot classpath jars are refused: their code is precompiled into the boot image.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import { throwIfCancelled } from '../context'
import { ZipFile } from '../formats/zip'
import { rewriteZip } from '../formats/zipwrite'
import { run } from '../spawn'
import { patchSet, type SmaliRule } from './patchsets'
import type { WorkTree } from './tree'

export interface PatchEnv {
  java: string
  apktool: string
  tmp: string
  signal: AbortSignal
  log: (s: string) => void
}

export interface TargetResult {
  path: string
  sets: string[]
  verifiedBuild: boolean
  changedDex: string[]
  removedArtifacts: string[]
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Device path of a tree path: system/system/x -> /system/x, product/x -> /product/x. */
export function devicePath(treePath: string): string {
  return treePath.startsWith('system/system/') ? treePath.slice('system'.length) : '/' + treePath
}

/** Locate `.method ... <sig>` .. `.end method` in a smali file. */
function methodRange(text: string, sig: string): { start: number; end: number } {
  const re = new RegExp(`^\\.method (?:[^\\n]* )?${esc(sig)}\\s*$`, 'm')
  const m = text.match(re)
  if (!m || m.index === undefined) throw new Error(`method ${sig} not found`)
  const start = m.index
  const end = text.indexOf('\n.end method', start)
  if (end < 0) throw new Error(`method ${sig} has no end`)
  return { start, end }
}

function stubBody(header: string, returns: 'void' | 0 | 1): string {
  if (returns === 'void') return `${header}\n    .locals 0\n\n    return-void`
  const isStatic = /\bstatic\b/.test(header)
  const params = (header.match(/\(([^)]*)\)/) as RegExpMatchArray)[1]
  // An instance method always has p0 (this); a static one only if it takes parameters.
  if (!isStatic || params.length) {
    return `${header}\n    .locals 0\n\n    const/4 p0, 0x${returns}\n\n    return p0`
  }
  return `${header}\n    .locals 1\n\n    const/4 v0, 0x${returns}\n\n    return v0`
}

/** Apply one rule to a smali text; returns the new text. Throws on a count mismatch. */
export function applyRule(
  text: string,
  rule: Exclude<SmaliRule, { kind: 'string-replace' }>
): string {
  const { start, end } = methodRange(text, rule.method)
  const header = text.slice(start, text.indexOf('\n', start))
  let body = text.slice(start, end)
  let count = 0
  switch (rule.kind) {
    case 'force-sget':
      body = body.replace(
        new RegExp(`^([ \\t]*)sget-boolean ([vp]\\d+), ${esc(rule.field)}[ \\t]*$`, 'gm'),
        (all, ind, reg) => {
          count++
          return `${all}\n\n${ind}const/4 ${reg}, 0x${rule.value}`
        }
      )
      break
    case 'force-sput':
      body = body.replace(
        new RegExp(`^([ \\t]*)sput-boolean ([vp]\\d+), ${esc(rule.field)}[ \\t]*$`, 'gm'),
        (all, ind, reg) => {
          count++
          return `${ind}const/4 ${reg}, 0x${rule.value}\n\n${all}`
        }
      )
      break
    case 'force-return':
      body = body.replace(/^([ \t]*)return ([vp]\d+)[ \t]*$/gm, (all, ind, reg) => {
        count++
        return `${ind}const/4 ${reg}, 0x${rule.value}\n\n${all}`
      })
      break
    case 'delete':
      body = body.replace(new RegExp(rule.pattern, 'g'), () => {
        count++
        return ''
      })
      break
    case 'stub': {
      // Keep annotations (e.g. Throws); replace everything else.
      const annotations = body.match(/^\s*\.annotation[\s\S]*?^\s*\.end annotation\s*$/gm) ?? []
      body =
        stubBody(header, rule.returns) + (annotations.length ? '\n' + annotations.join('\n') : '')
      count = 1
      break
    }
  }
  const expect = rule.kind === 'stub' ? 1 : rule.expect
  if (count !== expect) {
    throw new Error(
      `${rule.kind} in ${rule.cls} ${rule.method}: ${count} matches, expected ${expect}`
    )
  }
  return text.slice(0, start) + body + text.slice(end)
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

async function smaliDirs(dec: string): Promise<string[]> {
  return (await readdir(dec)).filter((n) => /^smali(_classes\d+)?$/.test(n)).sort()
}

const dexName = (smaliDir: string): string =>
  smaliDir === 'smali' ? 'classes.dex' : `${smaliDir.slice('smali_'.length)}.dex`

async function findClass(dec: string, cls: string): Promise<{ dir: string; file: string }> {
  for (const d of await smaliDirs(dec)) {
    const f = join(dec, d, `${cls}.smali`)
    if (existsSync(f)) return { dir: d, file: f }
  }
  throw new Error(`class ${cls} not found`)
}

async function walkSmali(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkSmali(p)))
    else if (e.name.endsWith('.smali')) out.push(p)
  }
  return out
}

async function apktool(env: PatchEnv, args: string[]): Promise<void> {
  const r = await run(env.java, ['-jar', env.apktool, ...args], { signal: env.signal })
  if (r.code !== 0) throw new Error(`apktool ${args[0]} failed: ${r.output.slice(-400)}`)
}

/** ART and fs-verity files that belong to a jar or APK in the tree. */
export function artifactsOf(tree: WorkTree, path: string): string[] {
  const out: string[] = []
  const add = (p: string): void => {
    if (tree.exists(p)) out.push(p)
  }
  add(`${path}.fsv_meta`)
  const dir = posix.dirname(path)
  const name = posix.basename(path).replace(/\.(apk|jar)$/, '')
  if (path.endsWith('.apk')) {
    add(`${dir}/oat`)
  } else {
    for (const arch of ['arm', 'arm64', 'x86', 'x86_64']) {
      for (const ext of ['odex', 'vdex', 'art']) {
        add(`${dir}/oat/${arch}/${name}.${ext}`)
        add(`${dir}/oat/${arch}/${name}.${ext}.fsv_meta`)
      }
    }
  }
  return out
}

/** Apply the rules of several patch sets that share one target file. */
export async function patchTarget(
  tree: WorkTree,
  path: string,
  setIds: string[],
  env: PatchEnv
): Promise<TargetResult> {
  const rules: SmaliRule[] = []
  let verified = true
  const original = await tree.read(path)
  const sha = createHash('sha256').update(original).digest('hex')
  for (const id of setIds) {
    for (const t of patchSet(id).targets.filter((x) => x.path === path)) {
      rules.push(...t.rules)
      if (t.verifiedSha256 !== sha) verified = false
    }
  }

  // Refuse boot classpath jars.
  const bcp = 'system/system/etc/classpaths/bootclasspath.pb'
  if (path.endsWith('.jar') && tree.exists(bcp)) {
    if ((await tree.read(bcp)).includes(Buffer.from(devicePath(path)))) {
      throw new Error(`${path} is on the boot classpath; patching it would need a new boot image`)
    }
  }

  const work = join(env.tmp, basename(path))
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const dec = join(work, 'dec')
  // apktool d: -f overwrite, -r keep resources as they are, --no-assets (apktool d --help).
  await apktool(env, ['d', '-q', '-f', '-r', '--no-assets', '-o', dec, tree.abs(path)])

  const touched = new Set<string>()
  for (const rule of rules) {
    throwIfCancelled(env.signal)
    if (rule.kind === 'string-replace') {
      let count = 0
      for (const d of await smaliDirs(dec)) {
        for (const f of await walkSmali(join(dec, d))) {
          const text = await readFile(f, 'utf8')
          const next = text.replace(
            /^([ \t]*const-string(?:\/jumbo)? [vp]\d+, ")(.*)("[ \t]*)$/gm,
            (all, a, s: string, b) => {
              if (!s.includes(rule.from)) return all
              count += s.split(rule.from).length - 1
              return a + s.split(rule.from).join(rule.to) + b
            }
          )
          if (next !== text) {
            await writeFile(f, next)
            touched.add(d)
          }
        }
      }
      if (count !== rule.expect) {
        throw new Error(`string-replace ${rule.from}: ${count} matches, expected ${rule.expect}`)
      }
    } else {
      const { dir, file } = await findClass(dec, rule.cls)
      await writeFile(file, applyRule(await readFile(file, 'utf8'), rule))
      touched.add(dir)
    }
  }

  // apktool b -o <file> <dir> (apktool b --help).
  const built = join(work, `built-${basename(path)}`)
  await apktool(env, ['b', '-q', '-o', built, dec])
  const replacements = new Map<string, Buffer>()
  const zip = await ZipFile.open(built)
  try {
    for (const d of touched) {
      const data = await zip.read(dexName(d), 512 * 1024 * 1024)
      if (!data) throw new Error(`rebuilt ${path} has no ${dexName(d)}`)
      replacements.set(dexName(d), data)
    }
  } finally {
    await zip.close()
  }
  const out = join(work, `out-${basename(path)}`)
  await rewriteZip(tree.abs(path), out, replacements)

  // Gate: the new dex files must decode to exactly the smali we wrote. The only tolerated
  // difference is the alignment `nop` the assembler adds or drops before a switch or array
  // payload when code before it moves (it pads the payload to 4 bytes).
  const check = join(work, 'check')
  await apktool(env, ['d', '-q', '-f', '-r', '--no-assets', '-o', check, out])
  for (const d of touched) {
    const want = await walkSmali(join(dec, d))
    const got = new Set(await walkSmali(join(check, d)))
    for (const f of want) {
      const g = f.replace(dec, check)
      if (!got.has(g)) throw new Error(`${path}: ${f.slice(dec.length)} missing after rebuild`)
      got.delete(g)
      const [a, b] = await Promise.all([readFile(f, 'utf8'), readFile(g, 'utf8')])
      if (normalizeSmali(a) !== normalizeSmali(b)) {
        throw new Error(
          `${path}: rebuilt dex does not match the patched smali in ${f.slice(dec.length + 1)}`
        )
      }
    }
    if (got.size) throw new Error(`${path}: rebuild produced unexpected classes`)
  }

  await tree.writeExisting(path, await readFile(out))
  const removedArtifacts: string[] = []
  for (const a of artifactsOf(tree, path)) {
    await tree.remove(a)
    removedArtifacts.push(a)
  }
  await rm(work, { recursive: true, force: true })
  env.log(
    `patched ${path} (${setIds.join(', ')}): ${[...replacements.keys()].join(', ')}${verified ? '' : ' [build not verified for these rules]'}`
  )
  return {
    path,
    sets: setIds,
    verifiedBuild: verified,
    changedDex: [...replacements.keys()],
    removedArtifacts
  }
}
