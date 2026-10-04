// Network test: downloads a real Temurin JRE (~50 MB). Opt-in with HK_NET_TESTS=1.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectJava, installManagedJre } from '../../src/worker/java'

describe.runIf(process.env.HK_NET_TESTS === '1')('managed JRE install', () => {
  it('downloads, verifies, extracts and is then detected as managed', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'hk-jre-'))
    const env = {
      platform: process.platform,
      arch: process.arch,
      binDir: null,
      commonBinDir: tmp,
      manifestPath: '',
      userData: tmp,
      managedJreDir: join(tmp, 'jre'),
      projectsRoot: tmp,
      javaPathSetting: ''
    }
    try {
      const info = await installManagedJre({
        jobId: 'j',
        env,
        signal: new AbortController().signal,
        progress: () => {},
        log: () => {}
      })
      expect(info.major).toBe(21)
      const found = await detectJava(env)
      expect(found?.source).toBe('managed')
      expect(found?.path).toBe(info.path)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 300_000)
})
