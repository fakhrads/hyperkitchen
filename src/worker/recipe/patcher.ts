// Applies smali patch sets to jars and APKs in work/fs.
//
// Per target file: apktool decode (no resources), edit smali with rules that must match an
// exact number of times, then appmod/rebuild.ts puts only the changed classesN.dex into the
// original zip and checks that they decode to exactly the edited smali. Stale ART artifacts
// (odex/vdex/art) and fs-verity metadata (.fsv_meta) of the patched file are removed, so ART
// loads the new dex.
//
// Boot classpath jars are refused: their code is precompiled into the boot image.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import {
  decode,
  decodeArgs,
  rebuildDecoded,
  smaliDirs,
  walkFiles,
  type DecodedChanges
} from '../appmod/rebuild'
import { throwIfCancelled } from '../context'
import { patchSet, type SmaliRule } from './patchsets'
import type { WorkTree } from './tree'

export { normalizeSmali } from '../appmod/rebuild'

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
  rule: Exclude<SmaliRule, { kind: 'string-replace' } | { kind: 'add-class' }>
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
    case 'wrap-call':
      body = body.replace(
        new RegExp(
          `^([ \\t]*)(invoke-[a-z/-]+ \\{[^}]*\\}, ${esc(rule.call)}[ \\t]*\\n(?:[ \\t]*\\n)*[ \\t]*move-result-object ([vp]\\d+))[ \\t]*$`,
          'gm'
        ),
        (all, ind: string, _call, reg: string) => {
          count++
          return `${all}\n\n${ind}invoke-static {${reg}}, ${rule.helper}\n\n${ind}move-result-object ${reg}`
        }
      )
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

async function findClass(dec: string, cls: string): Promise<{ dir: string; file: string }> {
  for (const d of await smaliDirs(dec)) {
    const f = join(dec, d, `${cls}.smali`)
    if (existsSync(f)) return { dir: d, file: f }
  }
  throw new Error(`class ${cls} not found`)
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
  const args = decodeArgs({ resources: false, assets: false })
  await decode(env, tree.abs(path), dec, args)

  const touched = new Set<string>()
  for (const rule of rules) {
    throwIfCancelled(env.signal)
    if (rule.kind === 'add-class') {
      const { dir } = await findClass(dec, rule.nextTo)
      const f = join(dec, dir, `${rule.cls}.smali`)
      for (const d of await smaliDirs(dec)) {
        if (existsSync(join(dec, d, `${rule.cls}.smali`)))
          throw new Error(`add-class: ${rule.cls} already exists`)
      }
      await mkdir(dirname(f), { recursive: true })
      await writeFile(f, rule.smali)
      touched.add(dir)
    } else if (rule.kind === 'string-replace') {
      let count = 0
      for (const d of await smaliDirs(dec)) {
        for (const f of await walkFiles(join(dec, d), (n) => n.endsWith('.smali'))) {
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

  const out = join(work, `out-${basename(path)}`)
  const changes: DecodedChanges = { smaliDirs: touched, resources: false, raw: new Map() }
  const rebuilt = await rebuildDecoded({
    env,
    orig: tree.abs(path),
    dec,
    args,
    changes,
    work,
    out,
    label: path
  })

  await tree.writeExisting(path, await readFile(out))
  const removedArtifacts: string[] = []
  for (const a of artifactsOf(tree, path)) {
    await tree.remove(a)
    removedArtifacts.push(a)
  }
  await rm(work, { recursive: true, force: true })
  env.log(
    `patched ${path} (${setIds.join(', ')}): ${rebuilt.replaced.join(', ')}${verified ? '' : ' [build not verified for these rules]'}`
  )
  return {
    path,
    sets: setIds,
    verifiedBuild: verified,
    changedDex: rebuilt.replaced,
    removedArtifacts
  }
}
