import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { platformKey } from '../../src/shared/platform'
import { SUPPORTED_PLATFORMS, type BinManifest } from '../../src/shared/types'
import { matchProbe, runDoctor } from '../../src/worker/doctor'

const root = resolve(__dirname, '../..')
const manifest = JSON.parse(
  readFileSync(join(root, 'resources/bin/manifest.json'), 'utf8')
) as BinManifest

describe('binary manifest', () => {
  it('pins every native tool for every supported platform and every jar for common', () => {
    for (const t of manifest.tools) {
      const keys = t.kind === 'native' ? SUPPORTED_PLATFORMS : (['common'] as const)
      for (const k of keys) {
        const a = t.artifacts[k]
        expect(a, `${t.id} ${k}`).toBeDefined()
        expect(a!.sha256, `${t.id} ${k}`).toMatch(/^[0-9a-f]{64}$/)
        expect(a!.url, `${t.id} ${k}`).toMatch(/^https:\/\//)
        if (a!.archive !== 'raw') expect(a!.member, `${t.id} ${k}`).toBeTruthy()
      }
      expect(t.license, t.id).toBeTruthy()
      expect(() => new RegExp(t.probe.match), t.id).not.toThrow()
    }
  })

  it('pins raw GitHub files to a commit, never a branch', () => {
    for (const t of manifest.tools) {
      for (const a of Object.values(t.artifacts)) {
        if (a!.url.includes('raw.githubusercontent.com')) expect(a!.url).toMatch(/\/[0-9a-f]{40}\//)
      }
    }
  })

  it('probe matcher extracts versions', () => {
    expect(
      matchProbe(
        'mkfs.erofs (erofs-utils) 1.8.10-gee46dd74\n',
        'mkfs\\.erofs \\(erofs-utils\\) (\\S+)'
      )
    ).toEqual({
      ok: true,
      version: '1.8.10-gee46dd74'
    })
    expect(
      matchProbe(
        '*** Zstandard CLI (64-bit) v1.5.5, by Yann Collet ***',
        'Zstandard CLI .* v(\\S+),'
      )
    ).toEqual({
      ok: true,
      version: '1.5.5'
    })
    expect(matchProbe('nothing', 'MagiskBoot').ok).toBe(false)
  })
})

// Runs only after `pnpm fetch-bins`: probes the real binaries on this host.
const key = platformKey(process.platform, process.arch)
const binDir = key ? join(root, 'resources/bin', key) : null
const fetched = !!binDir && existsSync(binDir) && readdirSync(binDir).length > 1

describe.runIf(fetched)('doctor on this host', () => {
  it('finds every pinned binary and they all execute', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'hk-doc-'))
    try {
      const report = await runDoctor({
        jobId: 't',
        signal: new AbortController().signal,
        progress: () => {},
        log: () => {},
        env: {
          platform: process.platform,
          arch: process.arch,
          binDir,
          commonBinDir: join(root, 'resources/bin/common'),
          manifestPath: join(root, 'resources/bin/manifest.json'),
          userData: tmp,
          managedJreDir: join(tmp, 'jre'),
          projectsRoot: join(tmp, 'projects'),
          javaPathSetting: ''
        }
      })
      const bins = report.checks.filter((c) => c.group === 'binaries')
      const natives = manifest.tools.filter((t) => t.kind === 'native').map((t) => `bin:${t.id}`)
      for (const id of natives) {
        const c = bins.find((b) => b.id === id)
        expect(c?.status, `${id}: ${c?.detail}`).toBe('ok')
      }
      // Jars are ok when Java is present, warn otherwise. Never error.
      for (const c of bins.filter((b) => b.id === 'bin:apkeditor' || b.id === 'bin:apktool')) {
        expect(['ok', 'warn'], `${c.id}: ${c.detail}`).toContain(c.status)
      }
      expect(report.checks.find((c) => c.id === 'host:platform')?.status).toBe('ok')
      for (const f of natives) expect(statSync(join(binDir!, f.slice(4))).mode & 0o111).not.toBe(0)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
