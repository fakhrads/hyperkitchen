// Runs a real unpack against a ROM on disk. Not part of `pnpm test`:
//   HK_ROM_INPUT=<tgz|zip|folder> HK_PROJECTS=<dir> HK_PROJECT=<name> npx vitest run --config tests/local/vitest.config.ts
import { appendFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { it } from 'vitest'
import { createProject } from '../../src/main/projects'
import { platformKey } from '../../src/shared/platform'
import { unpack } from '../../src/worker/unpack'

const root = resolve(__dirname, '../..')

it('unpacks a real ROM', async () => {
  const projects = process.env.HK_PROJECTS as string
  const name = process.env.HK_PROJECT as string
  const dir = join(projects, name)
  if (!existsSync(dir)) await createProject(projects, name)
  const log = join(dir, 'logs', 'unpack-test.log')
  let last = ''
  const t0 = Date.now()
  const r = await unpack(
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
        javaPathSetting: ''
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
      input: process.env.HK_ROM_INPUT as string,
      reset: process.env.HK_RESET === '1'
    }
  )
  appendFileSync(log, `RESULT ${JSON.stringify(r)} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
}, 3_600_000)
