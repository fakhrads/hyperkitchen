// app-replace: swap a ROM app's APK for an external one, keep metadata, remove stale artifacts,
// refuse a sharedUserId mismatch.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newReport } from '../../src/worker/recipe/ops'
import { applyAppReplace } from '../../src/worker/recipe/appreplace'
import { WorkTree } from '../../src/worker/recipe/tree'
import { OperationSchema, type Operation } from '../../src/shared/recipe'
import { axml, zip } from '../fixtures/apk'
import { createHash } from 'node:crypto'

const ANDROID = 'android'
const SHARED_UID = 0x0101000b

let tmp: string
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-replace-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function apk(pkg: string, sharedUserId?: string): Buffer {
  const attrs: Array<{ ns?: string; name: string; resId?: number; str?: string }> = [
    { name: 'package', str: pkg }
  ]
  if (sharedUserId)
    attrs.push({ ns: ANDROID, name: 'sharedUserId', resId: SHARED_UID, str: sharedUserId })
  return zip([['AndroidManifest.xml', axml([{ name: 'manifest', attrs, children: 0 }])]])
}

async function makeTree(originalApk: Buffer): Promise<string> {
  const root = join(tmp, `t${Math.random().toString(36).slice(2)}`)
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'product/priv-app/App/oat/arm64'), { recursive: true })
  await writeFile(join(root, 'product/priv-app/App/App.apk'), originalApk)
  await writeFile(join(root, 'product/priv-app/App/oat/arm64/App.odex'), 'stale')
  await writeFile(
    join(root, 'config/product_fs_config'),
    [
      '/ 0 0 0755',
      'product/ 0 0 0755',
      'product/priv-app 0 0 0755',
      'product/priv-app/App 0 0 0755',
      'product/priv-app/App/App.apk 0 1000 0644',
      'product/priv-app/App/oat 0 0 0755',
      'product/priv-app/App/oat/arm64 0 0 0755',
      'product/priv-app/App/oat/arm64/App.odex 0 0 0644',
      ''
    ].join('\n')
  )
  await writeFile(
    join(root, 'config/product_file_contexts'),
    [
      '/ u:object_r:system_file:s0',
      '/product u:object_r:system_file:s0',
      '/product/priv-app/App/App\\.apk u:object_r:system_file:s0',
      ''
    ].join('\n')
  )
  return root
}

const run = async (root: string, apkPath: string): Promise<ReturnType<typeof newReport>> => {
  const tree = await WorkTree.open(root, ['product'])
  const op = OperationSchema.parse({
    id: 'r',
    type: 'app-replace',
    params: {
      apk: apkPath,
      sha256: createHash('sha256')
        .update(await readFile(apkPath))
        .digest('hex'),
      target: 'product/priv-app/App/App.apk'
    }
  })
  const r = newReport(op)
  await applyAppReplace(
    { tree, apks: [], log: () => {} },
    op as Extract<Operation, { type: 'app-replace' }>,
    r
  )
  await tree.save()
  return r
}

describe('app-replace', () => {
  it('replaces the apk, keeps metadata, removes stale oat, warns on a package change', async () => {
    const root = await makeTree(apk('com.miui.home'))
    const ext = join(tmp, 'mod.apk')
    await writeFile(ext, apk('com.miui.home.mod'))
    const r = await run(root, ext)
    expect(r.modified).toContain('product/priv-app/App/App.apk')
    expect(r.removed).toContain('product/priv-app/App/oat')
    expect(r.warnings.join()).toMatch(/com\.miui\.home.*com\.miui\.home\.mod/)
    expect(
      (await readFile(join(root, 'product/priv-app/App/App.apk'))).equals(apk('com.miui.home.mod'))
    ).toBe(true)
    // The replacement keeps the original file's owner/mode (0 1000 0644).
    const fs = await readFile(join(root, 'config/product_fs_config'), 'utf8')
    expect(fs).toContain('product/priv-app/App/App.apk 0 1000 0644')
    expect(existsSync(join(root, 'product/priv-app/App/oat'))).toBe(false)
  })

  it('refuses a sharedUserId mismatch', async () => {
    const root = await makeTree(apk('com.android.settings', 'android.uid.system'))
    const ext = join(tmp, 'noUid.apk')
    await writeFile(ext, apk('com.other'))
    await expect(run(root, ext)).rejects.toThrow(/sharedUserId android\.uid\.system/)
  })

  it('refuses a changed sha256 and a non-apk target', async () => {
    const root = await makeTree(apk('com.x'))
    const ext = join(tmp, 'x.apk')
    await writeFile(ext, apk('com.x'))
    const tree = await WorkTree.open(root, ['product'])
    const bad = OperationSchema.parse({
      id: 'r',
      type: 'app-replace',
      params: { apk: ext, sha256: 'a'.repeat(64), target: 'product/priv-app/App/App.apk' }
    })
    await expect(
      applyAppReplace(
        { tree, apks: [], log: () => {} },
        bad as Extract<Operation, { type: 'app-replace' }>,
        newReport(bad)
      )
    ).rejects.toThrow(/changed since/)
  })
})
