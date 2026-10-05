// Worker jobs of the app editor. Params are validated in main (ModJobSchemas) before a job
// starts.

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { JobContext } from '../context'
import { throwIfCancelled } from '../context'
import { detectJava } from '../java'
import { buildMod, createMod, modPaths, openMod, readMod, saveMod, type ModEnv } from './mod'
import { readManifest } from '../formats/axml'
import { ZipFile } from '../formats/zip'
import { writeAdbPackage } from './adbpack'
import { walkFiles } from './rebuild'
import { ensureProjectKey, signApk } from './sign'

async function modEnv(ctx: JobContext, projectPath: string): Promise<ModEnv> {
  const java = await detectJava(ctx.env)
  if (!java) throw new Error('the app editor needs Java 17+ (install it from the Doctor)')
  return {
    java: java.path,
    apktool: join(ctx.env.commonBinDir, 'apktool.jar'),
    signal: ctx.signal,
    projectPath,
    log: (s) => ctx.log(s)
  }
}

export async function modCreateJob(
  ctx: JobContext,
  p: { projectPath: string; target: string; resources: boolean }
): Promise<unknown> {
  const env = await modEnv(ctx, p.projectPath)
  ctx.progress(null, 'creating')
  const mod = await createMod(env, { target: p.target, resources: p.resources })
  ctx.progress(null, p.resources ? 'decoding with resources' : 'decoding')
  await openMod(env, mod.id)
  return mod
}

export async function modOpenJob(
  ctx: JobContext,
  p: { projectPath: string; id: string; reset: boolean }
): Promise<unknown> {
  const env = await modEnv(ctx, p.projectPath)
  ctx.progress(null, 'decoding')
  return (await openMod(env, p.id, { reset: p.reset })).mod
}

export async function modSaveJob(
  ctx: JobContext,
  p: { projectPath: string; id: string }
): Promise<unknown> {
  const env = await modEnv(ctx, p.projectPath)
  ctx.progress(null, 'comparing with the stock decode')
  const changes = await saveMod(env, p.id)
  ctx.log(`${changes.length} changed files`)
  for (const c of changes) ctx.log(`  ${c.kind} ${c.path}`)
  return changes
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

const MAX_HITS = 1000

export async function modSearchJob(
  ctx: JobContext,
  p: {
    projectPath: string
    id: string
    query: string
    regex: boolean
    caseSensitive: boolean
    under: string
  }
): Promise<{ hits: SearchHit[]; truncated: boolean; files: number }> {
  const edit = modPaths(p.projectPath, p.id).edit
  const re = new RegExp(
    p.regex ? p.query : p.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    p.caseSensitive ? '' : 'i'
  )
  const root = p.under ? join(edit, p.under) : edit
  const files = await walkFiles(root)
  const hits: SearchHit[] = []
  let done = 0
  for (const f of files) {
    throwIfCancelled(ctx.signal)
    if (++done % 500 === 0) ctx.progress(done / files.length, `${done}/${files.length} files`)
    const rel = f.slice(edit.length + 1)
    if (/^(apktool\.yml|original\/|build\/)/.test(rel)) continue
    const b = await readFile(f)
    if (b.length > 4 * 1024 * 1024 || b.includes(0)) continue
    if (re.test(rel)) hits.push({ path: rel, line: 0, text: '(file name)' })
    const lines = b.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue
      hits.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 240) })
      if (hits.length >= MAX_HITS) return { hits, truncated: true, files: files.length }
    }
  }
  return { hits, truncated: false, files: files.length }
}

/**
 * Build the mod onto the stock file into mods/<id>/out/. The APK keeps the stock signing
 * block, so it is meant for the system partition (Android does not verify system APKs); it
 * cannot be installed with adb.
 */
export async function modExportJob(
  ctx: JobContext,
  p: { projectPath: string; id: string }
): Promise<{ path: string; replaced: string[]; added: number }> {
  const env = await modEnv(ctx, p.projectPath)
  const mod = await readMod(p.projectPath, p.id)
  const paths = modPaths(p.projectPath, p.id)
  ctx.progress(null, 'decoding, applying and rebuilding')
  await mkdir(paths.out, { recursive: true })
  const out = join(paths.out, basename(mod.target))
  const r = await buildMod(env, p.id, join(paths.stockFs, mod.target), out, join(paths.dir, 'work'))
  await writeFile(
    join(paths.out, 'README.txt'),
    [
      `${basename(mod.target)}: ${mod.target} with the edits of mod ${mod.id}.`,
      '',
      'The file keeps the stock APK Signing Block. Android reads, but does not verify,',
      'the signature of APKs on system partitions, so this file works when it replaces',
      `/${mod.target.replace(/^system\/system\//, 'system/')} in a ROM image (add the mod to the recipe and build).`,
      'It cannot be installed with adb: the signature no longer matches the content.',
      ''
    ].join('\n')
  )
  ctx.log(`written ${out}`)
  return { path: out, replaced: r.replaced, added: r.added }
}

/**
 * adb install package: the mod built onto the stock APK, re-signed with the project key, plus
 * adb and scripts the user runs. Refused for jars and for apps with a sharedUserId (their UID
 * is shared with apps signed by Xiaomi, so another key can never be installed).
 */
export async function modAdbJob(
  ctx: JobContext,
  p: { projectPath: string; id: string; generator: string }
): Promise<{ dir: string; apk: string; certSha256: string; scripts: string[] }> {
  const env = await modEnv(ctx, p.projectPath)
  const mod = await readMod(p.projectPath, p.id)
  const paths = modPaths(p.projectPath, p.id)
  if (!mod.target.endsWith('.apk')) throw new Error('only APKs can be installed with adb')
  const stockApk = join(paths.stockFs, mod.target)
  const z = await ZipFile.open(stockApk)
  let manifest
  try {
    const m = await z.read('AndroidManifest.xml')
    if (!m) throw new Error(`${mod.target} has no manifest`)
    manifest = readManifest(m)
  } finally {
    await z.close()
  }
  if (!manifest.packageName) throw new Error(`${mod.target}: no package name`)
  if (manifest.sharedUserId) {
    throw new Error(
      `${manifest.packageName} uses sharedUserId ${manifest.sharedUserId}; an app re-signed with another key can never join that UID, so it cannot be installed with adb. Use the recipe and a ROM build.`
    )
  }
  const signer = join(ctx.env.commonBinDir, 'apksigner.jar')
  if (!existsSync(signer)) throw new Error('apksigner.jar is missing (run pnpm fetch-bins)')
  let device: string | null = null
  try {
    device = (
      JSON.parse(await readFile(join(p.projectPath, 'stock', 'stock.json'), 'utf8')) as {
        device: string | null
      }
    ).device
  } catch {
    device = null
  }

  const dir = join(paths.dir, 'adb-package')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  ctx.progress(null, 'decoding, applying and rebuilding')
  const unsigned = join(paths.dir, 'work-adb.apk')
  await buildMod(env, p.id, stockApk, unsigned, join(paths.dir, 'work'))
  ctx.progress(null, 're-signing with the project key')
  const key = await ensureProjectKey({
    projectPath: p.projectPath,
    java: env.java,
    signal: ctx.signal,
    log: (s) => ctx.log(s)
  })
  const apkName = `${manifest.packageName}-hk.apk`
  const signed = await signApk({
    java: env.java,
    apksigner: signer,
    key,
    input: unsigned,
    output: join(dir, apkName),
    signal: ctx.signal
  })
  await rm(unsigned, { force: true })
  await rm(join(dir, `${apkName}.idsig`), { force: true })
  const pkg = await writeAdbPackage({
    dir,
    apkName,
    commonBinDir: ctx.env.commonBinDir,
    device,
    packageName: manifest.packageName,
    target: mod.target,
    certSha256: signed.certSha256,
    generator: p.generator
  })
  ctx.log(`${apkName}: signed (${signed.schemes.join(', ')}), certificate ${signed.certSha256}`)
  ctx.log(`${manifest.packageName} signed with the project key gets no store or OTA updates`)
  return { dir, apk: join(dir, apkName), certSha256: signed.certSha256, scripts: pkg.scripts }
}
