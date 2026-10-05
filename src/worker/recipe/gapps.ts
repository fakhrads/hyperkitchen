// GApps from a MindTheGapps zip the user provides (HyperKitchen never downloads it).
//
// Layout and install rules are those of the MindTheGapps installer itself
// (META-INF/com/google/android/update-binary, vendor_gapps branch baklava for Android 16):
// system/product/** goes to /product and system/system_ext/** to /system_ext, files 0644,
// directories 0755, owner root, SELinux label system_file; VelvetTitan is only for tangorpro;
// build.prop holds arch= and version= (the SDK level) which must match the ROM.
//
// Differences for a HyperOS CN base, all checked on onyx (OS3.0.305.0.WOLCNXM):
//   - The ROM already ships GmsCore, GSF, ConfigUpdater and OneTimeInitializer signed by
//     Google. A gapps APK whose package is already in the ROM is skipped when the ROM copy has
//     the same signer and an equal or newer versionCode; replaced when newer.
//   - com.android.vending in the CN ROM is GooglePlayServicesUpdater, signed with another key
//     than Play Store (Phonesky); with replaceDifferentSigner it is removed for Phonesky, as
//     PureCN does. The first boot then needs a data format.
//   - Files that already exist in the ROM (e.g. product/etc/sysconfig/google.xml, newer in the
//     ROM than in MindTheGapps 16) are kept.
//   - MindTheGapps removes Provision when it adds SetupWizard; HyperOS needs Provision, so
//     SetupWizard is excluded by default and Provision is never touched.
// Whether every privileged permission ends up allowlisted is checked for the whole build by
// privapp.ts.

import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { Operation, OperationReport } from '../../shared/recipe'
import type { ApkInfo } from '../../shared/types'
import { parseProps } from '../formats/buildprop'
import { ZipFile } from '../formats/zip'
import { hashFile } from '../fsutil'
import { inspectApk } from '../inventory'
import { apkRemovalTarget, type OpContext } from './ops'
import { artifactsOf } from './patcher'

export const GAPPS_DEFAULT_EXCLUDE = ['VelvetTitan', 'SetupWizard', 'GmsSetupWizardOverlay.apk']

/** Zip entry -> tree path, or null for installer files. */
export function gappsTreePath(entry: string): string | null {
  const m = entry.match(/^system\/(product|system_ext)\/(.+[^/])$/)
  return m ? `${m[1]}/${m[2]}` : null
}

/** The app unit of a tree path: product/priv-app/Phonesky, or the overlay APK itself. */
export function unitOf(treePath: string): string | null {
  const m = treePath.match(/^(product|system_ext)\/(app|priv-app)\/([^/]+)\//)
  if (m) return `${m[1]}/${m[2]}/${m[3]}`
  if (/^(product|system_ext)\/overlay\/[^/]+\.apk$/.test(treePath)) return treePath
  return null
}

const propMap = (text: string): Map<string, string> =>
  new Map(parseProps(text).map((p) => [p.key, p.value]))

const excluded = (unit: string, exclude: string[]): boolean =>
  exclude.includes(posix.basename(unit))

async function treeApks(ctx: OpContext): Promise<ApkInfo[]> {
  return ctx.apks.filter((a) => a.packageName && ctx.tree.exists(`${a.partition}/${a.path}`))
}

export async function applyGapps(
  ctx: OpContext,
  op: Extract<Operation, { type: 'gapps' }>,
  r: OperationReport,
  tmp: string
): Promise<void> {
  const { zip: zipPath, exclude, replaceDifferentSigner } = op.params
  if (op.params.sha256) {
    const got = await hashFile(zipPath, new AbortController().signal)
    if (got !== op.params.sha256)
      throw new Error(`${zipPath}: sha256 ${got} differs from the recipe (${op.params.sha256})`)
  }
  const z = await ZipFile.open(zipPath)
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  try {
    // Compatibility, as the MindTheGapps installer checks it.
    const bp = await z.read('build.prop')
    if (!bp) throw new Error('not a MindTheGapps zip (no build.prop)')
    const props = propMap(bp.toString('utf8'))
    const sysProps = propMap((await ctx.tree.read('system/system/build.prop')).toString('utf8'))
    const sdk = sysProps.get('ro.build.version.sdk')
    if (props.get('version') !== sdk)
      throw new Error(`the zip is for SDK ${props.get('version')}, the ROM is SDK ${sdk}`)
    const abis = (
      sysProps.get('ro.system.product.cpu.abilist') ??
      sysProps.get('ro.product.cpu.abilist') ??
      ''
    ).split(',')
    const arch = props.get('arch')
    const archAbi: Record<string, string> = { arm64: 'arm64-v8a', arm: 'armeabi-v7a' }
    if (!arch || !abis.includes(archAbi[arch] ?? arch))
      throw new Error(`the zip is for ${arch}, the ROM supports ${abis.join(', ')}`)

    // Group entries into app units and plain files.
    const units = new Map<string, Array<{ entry: string; tree: string }>>()
    const files: Array<{ entry: string; tree: string }> = []
    for (const name of z.entries.keys()) {
      const tree = gappsTreePath(name)
      if (!tree) continue
      const unit = unitOf(tree)
      if (unit) {
        if (excluded(unit, exclude)) continue
        units.set(unit, [...(units.get(unit) ?? []), { entry: name, tree }])
      } else files.push({ entry: name, tree })
    }

    const romApks = await treeApks(ctx)
    for (const [unit, members] of [...units].sort((a, b) => a[0].localeCompare(b[0]))) {
      const base = unit.endsWith('.apk') ? unit : `${unit}/${posix.basename(unit)}.apk`
      const baseMember = members.find((m) => m.tree === base)
      if (!baseMember) throw new Error(`${unit}: no ${posix.basename(base)} in the zip`)
      const extracted = join(tmp, createHash('sha1').update(base).digest('hex') + '.apk')
      await z.extract(baseMember.entry, extracted)
      const info = await inspectApk(unit.split('/')[0], tmp, extracted)
      if (!info.packageName) throw new Error(`${base}: ${info.error ?? 'no package name'}`)
      const rom = romApks.filter((a) => a.packageName === info.packageName && !a.error)
      const romBase = rom.find((a) => !/-[a-z]+dpi\.apk$|split_/.test(a.path)) ?? rom[0]
      if (romBase) {
        const where = `${romBase.partition}/${romBase.path}`
        const sameSigner = romBase.signerSha256 === info.signerSha256
        if (sameSigner && (romBase.versionCode ?? 0) >= (info.versionCode ?? 0)) {
          ctx.log(
            `  ${info.packageName}: kept the ROM's ${where} (${romBase.versionCode} >= ${info.versionCode})`
          )
          await rm(extracted, { force: true })
          continue
        }
        if (!sameSigner && !replaceDifferentSigner) {
          r.warnings.push(`${info.packageName}: skipped, the ROM's ${where} has another signer`)
          await rm(extracted, { force: true })
          continue
        }
        const target = apkRemovalTarget(where)
        for (const a of artifactsOf(ctx.tree, where)) {
          await ctx.tree.remove(a)
          r.removed.push(a)
        }
        await ctx.tree.remove(target)
        r.removed.push(target)
        if (!sameSigner) {
          r.warnings.push(
            `${info.packageName}: replaced the ROM's ${where} (signer ${romBase.signerSha256?.slice(0, 12)}) with one signed by ${info.signerSha256?.slice(0, 12)}; install with a data format`
          )
        } else {
          ctx.log(`  ${info.packageName}: replaced ${where} with the newer ${info.versionCode}`)
        }
      }
      if (ctx.tree.exists(unit))
        throw new Error(`${unit} already exists in the ROM with another package`)
      for (const m of members.sort((a, b) => a.tree.localeCompare(b.tree))) {
        if (m === baseMember) await ctx.tree.addFile(m.tree, { from: extracted })
        else {
          const f = join(tmp, 'member')
          await z.extract(m.entry, f)
          await ctx.tree.addFile(m.tree, { from: f })
          await rm(f, { force: true })
        }
        r.added.push(m.tree)
      }
      await rm(extracted, { force: true })
      ctx.log(`  ${info.packageName} ${info.versionName ?? ''}: added ${unit}`)
    }

    for (const f of files.sort((a, b) => a.tree.localeCompare(b.tree))) {
      if (ctx.tree.exists(f.tree)) {
        ctx.log(`  kept the ROM's ${f.tree}`)
        continue
      }
      const dest = join(tmp, 'file')
      await z.extract(f.entry, dest)
      await ctx.tree.addFile(f.tree, { from: dest })
      await rm(dest, { force: true })
      r.added.push(f.tree)
    }
  } finally {
    await z.close()
    await rm(tmp, { recursive: true, force: true })
  }
}

export interface GappsZipInfo {
  path: string
  sha256: string
  version: string | null
  arch: string | null
  /** App folders and overlay APKs, as names for the exclude list. */
  units: Array<{ name: string; tree: string; bytes: number }>
}

/** What a MindTheGapps zip holds, for the recipe editor. */
export async function inspectGappsZip(path: string): Promise<GappsZipInfo> {
  const z = await ZipFile.open(path)
  try {
    const bp = await z.read('build.prop')
    if (!bp) throw new Error('not a MindTheGapps zip (no build.prop)')
    const props = propMap(bp.toString('utf8'))
    const units = new Map<string, { name: string; tree: string; bytes: number }>()
    for (const [name, e] of z.entries) {
      const tree = gappsTreePath(name)
      const unit = tree && unitOf(tree)
      if (!unit) continue
      const u = units.get(unit) ?? { name: posix.basename(unit), tree: unit, bytes: 0 }
      u.bytes += e.size
      units.set(unit, u)
    }
    return {
      path,
      sha256: await hashFile(path, new AbortController().signal),
      version: props.get('version') ?? null,
      arch: props.get('arch') ?? null,
      units: [...units.values()].sort((a, b) => a.tree.localeCompare(b.tree))
    }
  } finally {
    await z.close()
  }
}
