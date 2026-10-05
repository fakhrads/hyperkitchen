// App mod on a real ROM: decode with resources, stub a method, add a string, save the overlay,
// build onto the stock file and run the gate. Not part of `pnpm test`:
//   HK_PROJECT_DIR=<project> HK_TARGET=<tree path> HK_CLASS=<smali path> HK_METHOD=<sig> \
//     npx vitest run --config tests/local/vitest.config.ts tests/local/appmod.local.test.ts
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { readSigner } from '../../src/worker/formats/apksig'
import { ZipFile } from '../../src/worker/formats/zip'
import {
  buildMod,
  createMod,
  modPaths,
  openMod,
  saveMod,
  type ModEnv
} from '../../src/worker/appmod/mod'
import { stubMethod } from '../../src/worker/appmod/smali'
import { setString } from '../../src/worker/appmod/strings'

const root = resolve(__dirname, '../..')
const project = process.env.HK_PROJECT_DIR as string
const log = (s: string): void => appendFileSync(join(project, 'logs', 'appmod-test.log'), s + '\n')

it('mods an app of a real ROM', async () => {
  writeFileSync(join(project, 'logs', 'appmod-test.log'), '')
  const env: ModEnv = {
    java: 'java',
    apktool: join(root, 'resources/bin/common/apktool.jar'),
    signal: new AbortController().signal,
    projectPath: project,
    log
  }
  const t0 = Date.now()
  const t = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`
  const mod = await createMod(env, { target: process.env.HK_TARGET as string, resources: true })
  log(`${t()} created ${mod.id}`)
  try {
    const { edit } = await openMod(env, mod.id)
    log(`${t()} opened`)
    const cls = join(edit, process.env.HK_CLASS as string)
    writeFileSync(cls, stubMethod(readFileSync(cls, 'utf8'), process.env.HK_METHOD as string, 0))
    const strings = join(edit, 'res/values/strings.xml')
    writeFileSync(
      strings,
      setString(readFileSync(strings, 'utf8'), 'hk_test_label', 'HyperKitchen & co')
    )
    const changes = await saveMod(env, mod.id)
    log(`${t()} saved: ${changes.map((c) => `${c.kind} ${c.path}`).join(', ')}`)
    expect(changes.map((c) => c.path).sort()).toEqual(
      [process.env.HK_CLASS as string, 'res/values/strings.xml'].sort()
    )

    const p = modPaths(project, mod.id)
    const out = join(p.dir, 'test-out.apk')
    const stock = join(project, 'stock/fs', mod.target)
    const r = await buildMod(env, mod.id, stock, out, join(p.dir, 'test-work'))
    log(`${t()} built: ${JSON.stringify(r)}`)
    expect(r.sameSource).toBe(true)
    // The original signing block and certificate are kept.
    const [za, zb] = await Promise.all([ZipFile.open(stock), ZipFile.open(out)])
    const [a, b] = await Promise.all([readSigner(za), readSigner(zb)])
    expect(b.certSha256).toBe(a.certSha256)
    expect(b.schemes).toEqual(a.schemes)
    expect(zb.entries.get('resources.arsc')?.method).toBe(0)
    await Promise.all([za.close(), zb.close()])
  } finally {
    await rm(modPaths(project, mod.id).dir, { recursive: true, force: true })
  }
})
