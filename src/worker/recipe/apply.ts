// Runs a recipe against work/fs. Order: file operations in recipe order, then smali patches
// grouped per target file (one decode/rebuild per jar or APK), then app mods. GApps is a
// file operation (recipe/gapps.ts). Config files are
// saved at the end so the rebuilt images carry metadata for exactly the files present.

import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Operation, OperationReport, Recipe } from '../../shared/recipe'
import type { ApkInfo } from '../../shared/types'
import { throwIfCancelled } from '../context'
import { buildMod, readMod } from '../appmod/mod'
import { applyGapps } from './gapps'
import { FILE_OPS, newReport, type OpContext, type OpRunner } from './ops'
import { patchSet } from './patchsets'
import { artifactsOf, patchTarget, type PatchEnv } from './patcher'
import { WorkTree } from './tree'

FILE_OPS.gapps = ((ctx, op, r) =>
  applyGapps(
    ctx,
    op as Extract<Operation, { type: 'gapps' }>,
    r,
    join(ctx.tmp as string, 'gapps')
  )) as OpRunner

export interface ApplyEnv {
  /** The project (app mods live in <project>/mods). */
  projectPath: string
  workFs: string
  partitions: string[]
  apks: ApkInfo[]
  stockVersion: string | null
  /** Needed only when the recipe has patch operations. */
  java: string | null
  apktool: string
  tmp: string
  signal: AbortSignal
  log: (s: string) => void
  progress: (frac: number, step: string) => void
}

export async function applyRecipe(recipe: Recipe, env: ApplyEnv): Promise<OperationReport[]> {
  const ops = recipe.operations.filter((o) => o.enabled)
  const reports: OperationReport[] = []
  if (!ops.length) return reports
  const tree = await WorkTree.open(env.workFs, env.partitions)
  const ctx: OpContext = {
    tree,
    apks: env.apks,
    log: env.log,
    stockVersion: env.stockVersion,
    tmp: join(env.tmp, 'ops')
  }

  const fileOps = ops.filter((o) => FILE_OPS[o.type])
  const patchOps = ops.filter((o): o is Extract<Operation, { type: 'patch' }> => o.type === 'patch')
  const modOps = ops.filter(
    (o): o is Extract<Operation, { type: 'app-mod' }> => o.type === 'app-mod'
  )
  const total = fileOps.length + patchOps.length + modOps.length || 1
  let done = 0

  for (const op of fileOps) {
    throwIfCancelled(env.signal)
    env.progress(done / total, `${op.type} ${op.id}`)
    const r = newReport(op)
    try {
      await (FILE_OPS[op.type] as NonNullable<(typeof FILE_OPS)[Operation['type']]>)(ctx, op, r)
    } catch (e) {
      throw new Error(`operation ${op.id} (${op.type}): ${(e as Error).message}`)
    }
    for (const w of r.warnings) env.log(`  ${op.id}: ${w}`)
    env.log(`${op.id} ${op.type}: -${r.removed.length} files/dirs, ~${r.modified.length} modified`)
    reports.push(r)
    done++
  }

  if (patchOps.length) {
    if (!env.java) throw new Error('smali patches need Java 17+ (install it from the Doctor)')
    const byTarget = new Map<string, string[]>()
    for (const op of patchOps) {
      for (const t of patchSet(op.params.patchSet).targets) {
        byTarget.set(t.path, [...(byTarget.get(t.path) ?? []), op.params.patchSet])
      }
    }
    const penv: PatchEnv = {
      java: env.java,
      apktool: env.apktool,
      tmp: join(env.tmp, 'patch'),
      signal: env.signal,
      log: env.log
    }
    const results = new Map<string, Awaited<ReturnType<typeof patchTarget>>>()
    let i = 0
    for (const [path, sets] of byTarget) {
      throwIfCancelled(env.signal)
      env.progress((done + (i++ / byTarget.size) * patchOps.length) / total, `patching ${path}`)
      if (!tree.exists(path))
        throw new Error(`patch target ${path} is missing (removed by debloat?)`)
      results.set(path, await patchTarget(tree, path, [...new Set(sets)], penv))
    }
    for (const op of patchOps) {
      const r = newReport(op)
      for (const t of patchSet(op.params.patchSet).targets) {
        const res = results.get(t.path)
        if (!res) continue
        r.modified.push(t.path)
        r.removed.push(...res.removedArtifacts.filter((a) => !r.removed.includes(a)))
        if (!res.verifiedBuild) {
          r.warnings.push(
            `${t.path} differs from the build these rules were verified on; matches were still exact`
          )
        }
      }
      reports.push(r)
    }
    done += patchOps.length
  }

  if (modOps.length) {
    if (!env.java) throw new Error('app mods need Java 17+ (install it from the Doctor)')
    const patched = new Set(
      patchOps.flatMap((o) => patchSet(o.params.patchSet).targets.map((t) => t.path))
    )
    const seen = new Set<string>()
    for (const op of modOps) {
      throwIfCancelled(env.signal)
      const r = newReport(op)
      const mod = await readMod(env.projectPath, op.params.mod)
      env.progress(done / total, `app mod ${mod.id}`)
      try {
        if (!tree.exists(mod.target))
          throw new Error(`${mod.target} is missing (removed by debloat?)`)
        if (patched.has(mod.target))
          throw new Error(`${mod.target} is also changed by a patch set; use one or the other`)
        if (seen.has(mod.target)) throw new Error(`${mod.target} has more than one app mod`)
        seen.add(mod.target)
        const work = join(env.tmp, 'mod', mod.id)
        const out = join(env.tmp, 'mod', `${mod.id}.out`)
        const res = await buildMod(
          {
            java: env.java,
            apktool: env.apktool,
            signal: env.signal,
            projectPath: env.projectPath,
            log: env.log
          },
          mod.id,
          tree.abs(mod.target),
          out,
          work
        )
        await tree.writeExisting(mod.target, await readFile(out))
        await rm(join(env.tmp, 'mod'), { recursive: true, force: true })
        r.modified.push(mod.target)
        for (const a of artifactsOf(tree, mod.target)) {
          await tree.remove(a)
          r.removed.push(a)
        }
        if (!res.sameSource) {
          r.warnings.push(
            `${mod.target} differs from the stock file the mod was made on; every edited file still matched`
          )
        }
        env.log(
          `app mod ${mod.id}: ${mod.target} (${[...res.replaced, res.added ? `${res.added} new entries` : ''].filter(Boolean).join(', ')})`
        )
      } catch (e) {
        throw new Error(`operation ${op.id} (app-mod ${op.params.mod}): ${(e as Error).message}`)
      }
      reports.push(r)
      done++
    }
  }

  await tree.save()
  env.progress(1, 'recipe applied')
  return reports
}
