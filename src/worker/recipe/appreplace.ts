// Replace an app in the ROM with an external APK (a modded launcher, SystemUI, etc.), keeping
// that APK's own signature. For a system-partition app Android reads the certificate without
// verifying it (InstallPackageHelper: skipVerify = scanSystemPartition), so a differently
// signed APK still loads; the app just can no longer be updated from the store or OTA.
//
// The target is an existing .apk path in the ROM. Its owner, mode and SELinux label are kept
// (the replacement inherits the original's metadata), and stale ART artifacts (oat/odex/vdex)
// plus split APKs of the original are removed so the new code is the one that runs.
//
// Refused when the original declares a sharedUserId that the replacement does not match: the
// platform would reject the whole UID (INSTALL_FAILED_SHARED_USER_INCOMPATIBLE) and the ROM
// could fail to boot. A different package name is allowed but warned about.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import type { Operation, OperationReport } from '../../shared/recipe'
import { readManifest } from '../formats/axml'
import { ZipFile } from '../formats/zip'
import { readSigner } from '../formats/apksig'
import type { OpContext } from './ops'
import { artifactsOf } from './patcher'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

interface ApkFacts {
  packageName: string | null
  sharedUserId: string | null
  signer: string | null
}

async function apkFacts(file: string): Promise<ApkFacts> {
  const z = await ZipFile.open(file)
  try {
    const m = await z.read('AndroidManifest.xml')
    const info = m ? readManifest(m) : null
    const signer = await readSigner(z).catch(() => ({ certSha256: null }))
    return {
      packageName: info?.packageName ?? null,
      sharedUserId: info?.sharedUserId ?? null,
      signer: signer.certSha256
    }
  } finally {
    await z.close()
  }
}

/** Sibling split APKs of the target (split_ or config prefixed), stale against the new base. */
async function splitSiblings(ctx: OpContext, target: string): Promise<string[]> {
  const dir = posix.dirname(target)
  const base = posix.basename(target)
  const abs = ctx.tree.abs(dir)
  if (!existsSync(abs)) return []
  const names = await readdir(abs)
  return names
    .filter((n) => n !== base && /\.apk$/.test(n) && /(^split_|^config\.|[._-]config[._-])/.test(n))
    .map((n) => `${dir}/${n}`)
    .filter((p) => ctx.tree.exists(p))
}

export async function applyAppReplace(
  ctx: OpContext,
  op: Extract<Operation, { type: 'app-replace' }>,
  r: OperationReport
): Promise<void> {
  const { apk, sha256, target } = op.params
  if (!target.endsWith('.apk')) throw new Error(`${target}: replace target must be an .apk path`)
  if (!ctx.tree.exists(target)) throw new Error(`${target} is not in this ROM`)

  const data = await readFile(apk)
  if (sha(data) !== sha256) throw new Error(`${apk} changed since it was added (sha256 differs)`)

  const incoming = await apkFacts(apk)
  if (!incoming.packageName) throw new Error(`${apk}: not a valid APK (no package name)`)
  const original = await apkFacts(ctx.tree.abs(target))

  if (original.sharedUserId && original.sharedUserId !== incoming.sharedUserId) {
    throw new Error(
      `${target} uses sharedUserId ${original.sharedUserId}; the replacement ${
        incoming.sharedUserId ? `uses ${incoming.sharedUserId}` : 'declares none'
      }. Android would reject the shared UID and the ROM may not boot. Use an APK with the same sharedUserId.`
    )
  }
  if (original.packageName && incoming.packageName !== original.packageName) {
    r.warnings.push(
      `${target} was ${original.packageName}; the replacement is ${incoming.packageName}. Anything that referenced the old package (components, launchers) may break.`
    )
  }
  if (original.signer && incoming.signer !== original.signer) {
    r.warnings.push(
      `${incoming.packageName}: signed differently from the stock app, so it can no longer be updated from the store or OTA. It still loads on the system partition.`
    )
  }

  await ctx.tree.writeExisting(target, data)
  r.modified.push(target)
  for (const a of artifactsOf(ctx.tree, target)) {
    await ctx.tree.remove(a)
    r.removed.push(a)
  }
  for (const s of await splitSiblings(ctx, target)) {
    await ctx.tree.remove(s)
    r.removed.push(s)
  }
  ctx.log(
    `app-replace: ${target} -> ${incoming.packageName}${
      incoming.signer === original.signer ? '' : ' (re-signed by its author)'
    }`
  )
}
