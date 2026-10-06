// Applies the installer-no-ads patch set to a copy of the real MIUIPackageInstaller.apk and
// checks the full patcher gate (apktool build + decode-again round-trip) passes. Not part of
// `pnpm test`: needs the real APK and a JDK.
//   HK_APK=<MIUIPackageInstaller.apk> HK_SCRATCH=<dir> \
//     npx vitest run --config tests/local/vitest.config.ts tests/local/installer-noads.local.test.ts
import { readFile, writeFile, rm, mkdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { expect, it } from 'vitest'
import { patchTarget } from '../../src/worker/recipe/patcher'

const apk = process.env.HK_APK as string
const scratch = process.env.HK_SCRATCH as string
const P = 'product/priv-app/MIUIPackageInstaller/MIUIPackageInstaller.apk'

it('removes the installer ads and the build gate passes', async () => {
  const root = join(scratch, 'tree')
  await rm(scratch, { recursive: true, force: true })
  await mkdir(dirname(join(root, P)), { recursive: true })
  await copyFile(apk, join(root, P))

  const tree = {
    abs: (p: string) => join(root, p),
    read: (p: string) => readFile(join(root, p)),
    exists: (p: string) => existsSync(join(root, p)),
    writeExisting: (p: string, b: Buffer) => writeFile(join(root, p), b),
    remove: (p: string) => rm(join(root, p), { force: true })
  } as never

  const env = {
    java: process.env.HK_JAVA ?? 'java',
    apktool: join(process.cwd(), 'resources/bin/common/apktool.jar'),
    tmp: join(scratch, 'tmp'),
    signal: new AbortController().signal,
    log: (m: string) => console.log('[log]', m)
  } as never

  const before = (await stat(join(root, P))).size
  const r = await patchTarget(tree, P, ['installer-no-ads'], env)
  const after = (await stat(join(root, P))).size

  expect(r.verifiedBuild).toBe(true)
  expect(r.changedDex.length).toBeGreaterThan(0)
  expect(after).toBeGreaterThan(0)
  console.log('changedDex', r.changedDex, 'size', before, '->', after)
})
