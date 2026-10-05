// adb package of a real app mod: build onto stock, re-sign with the project key, scripts.
// Not part of `pnpm test`:
//   HK_PROJECT_DIR=<project> HK_MOD=<mod id> [HK_SHARED_UID_TARGET=<tree path>] \
//     npx vitest run --config tests/local/vitest.config.ts tests/local/appmod-adb.local.test.ts
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { platformKey } from '../../src/shared/platform'
import { modAdbJob } from '../../src/worker/appmod/jobs'
import { createMod, modPaths } from '../../src/worker/appmod/mod'
import type { JobContext } from '../../src/worker/context'

const root = resolve(__dirname, '../..')
const project = process.env.HK_PROJECT_DIR as string
const lines: string[] = []
const ctx: JobContext = {
  jobId: 'local',
  signal: new AbortController().signal,
  env: {
    platform: process.platform,
    arch: process.arch,
    binDir: join(root, 'resources/bin', platformKey(process.platform, process.arch) as string),
    commonBinDir: join(root, 'resources/bin/common'),
    manifestPath: join(root, 'resources/bin/manifest.json'),
    userData: project,
    managedJreDir: join(project, 'jre'),
    projectsRoot: join(project, '..'),
    javaPathSetting: ''
  },
  progress: () => {},
  log: (t) => void lines.push(t)
}

it('writes a re-signed adb package for a mod', async () => {
  const r = await modAdbJob(ctx, {
    projectPath: project,
    id: process.env.HK_MOD as string,
    generator: 'HyperKitchen local test'
  })
  console.log(JSON.stringify(r), lines.join('\n'))
  const v = spawnSync(
    'java',
    [
      '--enable-native-access=ALL-UNNAMED',
      '-jar',
      join(root, 'resources/bin/common/apksigner.jar'),
      'verify',
      '--print-certs',
      r.apk
    ],
    { encoding: 'utf8' }
  )
  expect(v.status).toBe(0)
  expect(v.stdout).toContain(r.certSha256)
  for (const s of ['macos_adb_install.sh', 'linux_adb_install.sh'])
    expect(spawnSync('sh', ['-n', join(r.dir, s)]).status).toBe(0)
  for (const b of ['bin/macos/adb', 'bin/linux/adb', 'bin/windows/adb.exe', 'README.txt'])
    expect(existsSync(join(r.dir, b)), b).toBe(true)
  console.log(readFileSync(join(r.dir, 'README.txt'), 'utf8'))
})

it('refuses apps with a sharedUserId', async () => {
  const target = process.env.HK_SHARED_UID_TARGET
  if (!target) return
  const env = { java: 'java', apktool: '', signal: ctx.signal, projectPath: project, log: () => {} }
  const mod = await createMod(env, { target, resources: false })
  try {
    await expect(
      modAdbJob(ctx, { projectPath: project, id: mod.id, generator: 'x' })
    ).rejects.toThrow(/sharedUserId android\.uid\.system/)
  } finally {
    await rm(modPaths(project, mod.id).dir, { recursive: true, force: true })
  }
})
