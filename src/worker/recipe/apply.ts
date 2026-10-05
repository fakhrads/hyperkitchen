// Runs a recipe against work/fs. Order: file operations in recipe order, then smali patches
// grouped per target file (one decode/rebuild per jar or APK), then GApps. Config files are
// saved at the end so the rebuilt images carry metadata for exactly the files present.

import { join } from 'node:path'
import type { Operation, OperationReport, Recipe } from '../../shared/recipe'
import type { ApkInfo } from '../../shared/types'
import { throwIfCancelled } from '../context'
import { FILE_OPS, newReport, type OpContext } from './ops'
import { patchSet } from './patchsets'
import { patchTarget, type PatchEnv } from './patcher'
import { WorkTree } from './tree'

export interface ApplyEnv {
  workFs: string
  partitions: string[]
  apks: ApkInfo[]
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
  const ctx: OpContext = { tree, apks: env.apks, log: env.log }

  const fileOps = ops.filter((o) => FILE_OPS[o.type])
  const patchOps = ops.filter((o): o is Extract<Operation, { type: 'patch' }> => o.type === 'patch')
  const gappsOps = ops.filter((o) => o.type === 'gapps')
  if (gappsOps.length) throw new Error('the gapps operation is not available yet')
  const total = fileOps.length + patchOps.length || 1
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
  }

  await tree.save()
  env.progress(1, 'recipe applied')
  return reports
}
