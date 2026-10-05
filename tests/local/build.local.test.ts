// Runs a real build of an unpacked project. Not part of `pnpm test`:
//   HK_PROJECTS=<dir> HK_PROJECT=<name> [HK_VERITY=fstab|vbmeta-flags] [HK_VERIFY=0] \
//     npx vitest run --config tests/local/vitest.config.ts tests/local/build.local.test.ts
import { appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { it } from 'vitest'
import { platformKey } from '../../src/shared/platform'
import { build } from '../../src/worker/build'

const root = resolve(__dirname, '../..')

it('builds a real ROM', async () => {
  const projects = process.env.HK_PROJECTS as string
  const dir = join(projects, process.env.HK_PROJECT as string)
  const log = join(dir, 'logs', 'build-test.log')
  let last = ''
  const t0 = Date.now()
  const r = await build(
    {
      jobId: 'local',
      signal: new AbortController().signal,
      env: {
        platform: process.platform,
        arch: process.arch,
        binDir: join(root, 'resources/bin', platformKey(process.platform, process.arch) as string),
        commonBinDir: join(root, 'resources/bin/common'),
        manifestPath: join(root, 'resources/bin/manifest.json'),
        userData: dir,
        managedJreDir: join(dir, 'jre'),
        projectsRoot: projects,
        javaPathSetting: '',
        updaterPath: join(root, 'resources/updater/update-binary')
      },
      progress: (p, step) => {
        const s = `${((p ?? 0) * 100).toFixed(0)}% ${step ?? ''}`
        if (s !== last) appendFileSync(log, `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}\n`)
        last = s
      },
      log: (text, stream) => appendFileSync(log, `${stream ?? 'info'}: ${text}\n`)
    },
    {
      projectPath: dir,
      verity: process.env.HK_VERITY === 'vbmeta-flags' ? 'vbmeta-flags' : 'fstab',
      verify: process.env.HK_VERIFY !== '0',
      zip: process.env.HK_ZIP !== '0',
      generator: 'HyperKitchen local test'
    }
  )
  appendFileSync(log, `RESULT ${r.id} ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
}, 7_200_000)
