// Recipe operations that edit files directly (M4). Smali patches and GApps live in their own
// modules. Every operation works through WorkTree so fs_config/file_contexts stay in sync.

import {
  lstat as lstatAsync,
  readdir as readdirAsync,
  readFile as readFileAsync
} from 'node:fs/promises'
import { join as joinPath, posix } from 'node:path'
import type { ApkInfo } from '../../shared/types'
import type { Operation, OperationReport } from '../../shared/recipe'
import { parseProps } from '../formats/buildprop'
import { artifactsOf } from './patcher'
import { WorkTree } from './tree'

export interface OpContext {
  tree: WorkTree
  apks: ApkInfo[]
  log: (s: string) => void
  /** romVersion of the stock ROM being modified (stock.json). */
  stockVersion?: string | null
  /** Scratch directory for operations that extract files. */
  tmp?: string
}

/**
 * Shared UIDs whose apps are core system components. Removing one can stop the system from
 * booting or break telephony, so debloat refuses them unless forced.
 */
const PROTECTED_SHARED_UIDS = new Set([
  'android.uid.system',
  'android.uid.phone',
  'android.uid.systemui',
  'android.uid.shell',
  'android.uid.networkstack',
  'android.uid.bluetooth',
  'android.uid.nfc',
  'android.uid.se'
])
const PROTECTED_PACKAGES = new Set(['android', 'com.android.systemui', 'com.android.settings'])

export function newReport(op: Operation): OperationReport {
  return { id: op.id, type: op.type, added: [], removed: [], modified: [], warnings: [] }
}

/** The tree path of an inventory entry: <partition>/<path>. */
const treePath = (a: ApkInfo): string => `${a.partition}/${a.path}`

/** What to delete for an APK: its own app folder (Name/Name.apk), else just the file. */
export function apkRemovalTarget(apkTreePath: string): string {
  const dir = posix.dirname(apkTreePath)
  return posix.basename(dir) === posix.basename(apkTreePath, '.apk') ? dir : apkTreePath
}

async function removePaths(
  ctx: OpContext,
  op: Extract<Operation, { type: 'remove-paths' }>,
  r: OperationReport
): Promise<void> {
  for (const p of op.params.paths) {
    await ctx.tree.remove(p)
    r.removed.push(p)
  }
}

async function debloat(
  ctx: OpContext,
  op: Extract<Operation, { type: 'debloat' }>,
  r: OperationReport
): Promise<void> {
  for (const pkg of op.params.packages) {
    const apks = ctx.apks.filter((a) => a.packageName === pkg)
    if (!apks.length) throw new Error(`debloat: ${pkg} is not in the stock inventory`)
    const shared = apks.map((a) => a.sharedUserId).find((u) => u && PROTECTED_SHARED_UIDS.has(u))
    if ((shared || PROTECTED_PACKAGES.has(pkg)) && !op.params.force) {
      throw new Error(
        `debloat: ${pkg} is a core system package${shared ? ` (sharedUserId ${shared})` : ''}; set force to remove it`
      )
    }
    const overlays = ctx.apks.filter(
      (a) => a.overlayTarget === pkg && !op.params.packages.includes(a.packageName ?? '')
    )
    for (const o of overlays)
      r.warnings.push(`${o.packageName} (${treePath(o)}) is an overlay for ${pkg} and stays`)
    for (const a of apks) {
      const target = apkRemovalTarget(treePath(a))
      if (!ctx.tree.exists(target)) continue
      await ctx.tree.remove(target)
      r.removed.push(target)
    }
  }
}

/** Edit key=value lines in place; new keys are appended under a marker comment. */
export function editProps(text: string, set: Record<string, string>, remove: string[]): string {
  const lines = text.split('\n')
  const done = new Set<string>()
  const keyOf = (l: string): string | null => {
    const p = parseProps(l)
    return p.length ? p[0].key : null
  }
  const out: string[] = []
  for (const l of lines) {
    const k = keyOf(l)
    if (k && remove.includes(k)) continue
    if (k && k in set) {
      if (!done.has(k)) out.push(`${k}=${set[k]}`)
      done.add(k)
      continue
    }
    out.push(l)
  }
  const fresh = Object.keys(set).filter((k) => !done.has(k))
  if (fresh.length) {
    while (out.length && out[out.length - 1] === '') out.pop()
    out.push('', '# Added by HyperKitchen', ...fresh.map((k) => `${k}=${set[k]}`), '')
  }
  return out.join('\n')
}

async function setProps(
  ctx: OpContext,
  op: Extract<Operation, { type: 'set-props' }>,
  r: OperationReport
): Promise<void> {
  const text = (await ctx.tree.read(op.params.file)).toString('utf8')
  const next = editProps(text, op.params.set, op.params.remove)
  if (next !== text) {
    await ctx.tree.writeExisting(op.params.file, next)
    r.modified.push(op.params.file)
  }
}

/** Drop whole lines matching any pattern; the remaining XML stays well formed. */
export function dropLines(text: string, patterns: RegExp[]): { text: string; dropped: number } {
  const lines = text.split('\n')
  const kept = lines.filter((l) => !patterns.some((p) => p.test(l)))
  return { text: kept.join('\n'), dropped: lines.length - kept.length }
}

const CN_GMS_FEATURES = [
  /<feature\s+name="cn\.google\.services"\s*\/>/,
  /<feature\s+name="com\.google\.android\.feature\.services_updater"\s*\/>/
]

async function unlockCnGms(
  ctx: OpContext,
  op: Extract<Operation, { type: 'unlock-cn-gms' }>,
  r: OperationReport
): Promise<void> {
  // Files from the stock onyx ROM that declare the CN GMS features. PureCN removes the
  // product file and disables the odm GNSS one; we drop only the feature lines.
  const files = ['product/etc/permissions/cn.google.services.xml']
  if (op.params.includeGnss) files.push('odm/etc/permissions/com.gnss.bds_preference.xml')
  let total = 0
  for (const f of files) {
    if (!ctx.tree.exists(f)) {
      r.warnings.push(`${f} not found`)
      continue
    }
    const { text, dropped } = dropLines((await ctx.tree.read(f)).toString('utf8'), CN_GMS_FEATURES)
    if (dropped) {
      await ctx.tree.writeExisting(f, text)
      r.modified.push(f)
      total += dropped
    }
  }
  if (!total) throw new Error('unlock-cn-gms: no cn.google.services feature found to remove')
}

/**
 * The PureCN onyx edit: drop file-based and metadata encryption from the /data entries of
 * vendor/etc/fstab.qcom and report ro.crypto.state=encrypted. Data is then stored unencrypted.
 */
async function disableEncryption(
  ctx: OpContext,
  _op: Extract<Operation, { type: 'disable-encryption' }>,
  r: OperationReport
): Promise<void> {
  const fstab = 'vendor/etc/fstab.qcom'
  const text = (await ctx.tree.read(fstab)).toString('utf8')
  let changed = 0
  const out = text.split('\n').map((l) => {
    if (!/^\S+\s+\/data\s/.test(l)) return l
    const parts = l.split(/(\s+)/)
    let field = -1
    for (let k = 0; k < parts.length; k++) {
      if (!parts[k] || /^\s+$/.test(parts[k])) continue
      if (++field !== 4) continue
      const kept = parts[k]
        .split(',')
        .filter((f) => !/^(fileencryption|metadata_encryption|keydirectory)=/.test(f))
      if (kept.join(',') !== parts[k]) changed++
      parts[k] = kept.join(',')
    }
    return parts.join('')
  })
  if (!changed)
    throw new Error('disable-encryption: no encrypted /data entry in vendor/etc/fstab.qcom')
  await ctx.tree.writeExisting(fstab, out.join('\n'))
  r.modified.push(fstab)
  const prop = 'system_ext/etc/build.prop'
  await ctx.tree.writeExisting(
    prop,
    editProps((await ctx.tree.read(prop)).toString('utf8'), { 'ro.crypto.state': 'encrypted' }, [])
  )
  r.modified.push(prop)
  r.warnings.push(
    'user data will be stored UNENCRYPTED; the device must be formatted (flash_all wipes data)'
  )
}

export type OpRunner = (ctx: OpContext, op: Operation, r: OperationReport) => Promise<void>

export const FILE_OPS: Partial<Record<Operation['type'], OpRunner>> = {
  'remove-paths': removePaths as OpRunner,
  debloat: debloat as OpRunner,
  'set-props': setProps as OpRunner,
  'unlock-cn-gms': unlockCnGms as OpRunner,
  'disable-encryption': disableEncryption as OpRunner
}

// ---- import-from-rom

/**
 * Copy files from another unpacked ROM (a HyperKitchen project the user owns), keeping the
 * exact owner, mode, capabilities and SELinux label recorded in that ROM's fs_config and
 * file_contexts. Nothing is downloaded or bundled by HyperKitchen.
 */
async function importFromRom(
  ctx: OpContext,
  op: Extract<Operation, { type: 'import-from-rom' }>,
  r: OperationReport
): Promise<void> {
  // Replacing stock files with files from another ROM is only safe when both are built on the
  // same base version: the replaced apps run against this ROM's framework.
  if (op.params.replace.length) {
    let refVersion: string | null = null
    try {
      refVersion = (
        JSON.parse(
          await readFileAsync(joinPath(op.params.project, 'stock', 'stock.json'), 'utf8')
        ) as {
          romVersion: string | null
        }
      ).romVersion
    } catch {
      throw new Error(`${op.params.project} is not an unpacked HyperKitchen project`)
    }
    if (!refVersion || refVersion !== ctx.stockVersion) {
      throw new Error(
        `replacing files needs the same base ROM: source ${refVersion ?? '?'}, this ROM ${ctx.stockVersion ?? '?'}`
      )
    }
  }
  const parts = [...new Set(op.params.paths.map((p) => p.split('/')[0]))]
  const ref = await WorkTree.open(joinPath(op.params.project, 'stock', 'fs'), parts)
  const copy = async (rel: string): Promise<void> => {
    const src = ref.abs(rel)
    const st = await lstatAsync(src)
    const meta = ref.meta(rel)
    if (!meta) throw new Error(`${rel}: no metadata in the source ROM`)
    if (st.isSymbolicLink()) throw new Error(`${rel}: symlinks are not supported`)
    if (st.isDirectory()) {
      await ctx.tree.addDir(rel, meta)
      for (const n of (await readdirAsync(src)).sort()) await copy(`${rel}/${n}`)
      return
    }
    if (ctx.tree.exists(rel)) {
      if (!op.params.replace.includes(rel)) {
        throw new Error(`${rel} already exists in the ROM; list it under replace to overwrite it`)
      }
      await ctx.tree.remove(rel)
      r.modified.push(rel)
      // The stock odex/vdex of a replaced jar or APK no longer match it.
      if (/\.(apk|jar)$/.test(rel)) {
        for (const a of artifactsOf(ctx.tree, rel)) {
          await ctx.tree.remove(a)
          r.removed.push(a)
        }
      }
    } else r.added.push(rel)
    await ctx.tree.addFile(rel, { from: src }, { fsRest: meta.fsRest, label: meta.label })
  }
  for (const p of op.params.paths) {
    if (!ref.exists(p)) throw new Error(`${p} is not in the source ROM`)
    await copy(p)
  }
  ctx.log(`  imported ${r.added.length} files, replaced ${r.modified.length}`)
}

FILE_OPS['import-from-rom'] = importFromRom as OpRunner

const DEVICE_INFO = 'product/etc/device_info.json'

/**
 * Write product/etc/device_info.json, the source of the About phone spec card (CPU, battery,
 * camera, screen). HyperOS CN stock has no such file; PureCN adds one. Empty values in `basic`
 * or `camera` are dropped so the card does not show blank rows.
 */
async function specCard(
  ctx: OpContext,
  op: Extract<Operation, { type: 'spec-card' }>,
  r: OperationReport
): Promise<void> {
  const clean = (m: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim() !== ''))
  const json = op.params.entries.map((e) => {
    const out: Record<string, unknown> = { hwc: e.hwc }
    const basic = clean(e.basic)
    const camera = clean(e.camera)
    if (Object.keys(basic).length) out.basic = basic
    if (Object.keys(camera).length) out.camera = camera
    return out
  })
  const data = Buffer.from(JSON.stringify(json, null, 4) + '\n')
  if (ctx.tree.exists(DEVICE_INFO)) {
    await ctx.tree.writeExisting(DEVICE_INFO, data)
    r.modified.push(DEVICE_INFO)
  } else {
    await ctx.tree.addFile(DEVICE_INFO, data, { uid: 0, gid: 0, mode: 0o644 })
    r.added.push(DEVICE_INFO)
  }
}
FILE_OPS['spec-card'] = specCard as OpRunner
