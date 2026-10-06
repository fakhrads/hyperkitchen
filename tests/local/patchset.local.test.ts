// Applies one patch set to a copy of a real APK and checks the full patcher gate (apktool build
// plus decode-again round-trip) passes. Not part of `pnpm test`: needs the real APK and a JDK,
// and MUST run on a case-sensitive volume (see the Mac host memory). Example:
//   HK_APK=<apk> HK_TREEPATH=<path/in/rom.apk> HK_SET=<patch-set-id> HK_SCRATCH=/Volumes/HKWork/tmp/x \
//     npx vitest run --config tests/local/vitest.config.ts tests/local/patchset.local.test.ts
import { readFile, writeFile, rm, mkdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { expect, it } from 'vitest'
import { patchTarget } from '../../src/worker/recipe/patcher'

const apk = process.env.HK_APK as string
const treePath = process.env.HK_TREEPATH as string
const setId = process.env.HK_SET as string
const scratch = process.env.HK_SCRATCH as string

it(`applies ${setId} and the build gate passes`, async () => {
  const root = join(scratch, 'tree')
  await rm(scratch, { recursive: true, force: true })
  await mkdir(dirname(join(root, treePath)), { recursive: true })
  await copyFile(apk, join(root, treePath))

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

  const before = (await stat(join(root, treePath))).size
  const r = await patchTarget(tree, treePath, [setId], env)
  const after = (await stat(join(root, treePath))).size

  expect(r.verifiedBuild).toBe(true)
  expect(r.changedDex.length).toBeGreaterThan(0)
  expect(after).toBeGreaterThan(0)
  console.log(setId, 'changedDex', r.changedDex, 'size', before, '->', after)
})
