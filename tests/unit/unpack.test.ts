// Unpack job end to end on a synthetic ROM built with the real tools (needs `pnpm fetch-bins`).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProject } from '../../src/main/projects'
import { platformKey } from '../../src/shared/platform'
import type { Inventory, ProjectMeta, StockInfo } from '../../src/shared/types'
import type { JobContext } from '../../src/worker/context'
import { run } from '../../src/worker/spawn'
import { unpack } from '../../src/worker/unpack'
import { buildFastbootRom, TEST_CERT } from '../fixtures/rom'

const root = resolve(__dirname, '../..')
const key = platformKey(process.platform, process.arch)
const binDir = key ? join(root, 'resources/bin', key) : ''
const haveBins = !!key && existsSync(binDir) && readdirSync(binDir).includes('mkfs.erofs')

let tmp: string
let rom: string

function ctx(projectsRoot: string, ac = new AbortController()): JobContext {
  return {
    jobId: 't',
    signal: ac.signal,
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
      projectsRoot,
      javaPathSetting: ''
    }
  }
}

describe.runIf(haveBins)('unpack', () => {
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'hk-unpack-'))
    rom = await buildFastbootRom(join(tmp, 'fixture'), binDir)
    // tar -c -z -f <out> -C <dir> <member> (bsdtar --help / GNU tar).
    const t = await run('tar', [
      '-c',
      '-z',
      '-f',
      join(tmp, 'rom.tgz'),
      '-C',
      join(tmp, 'fixture'),
      'rom'
    ])
    if (t.code !== 0) throw new Error(t.output)
  }, 60_000)
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  async function check(project: string, kind: string): Promise<StockInfo> {
    const stock = JSON.parse(
      await readFile(join(project, 'stock', 'stock.json'), 'utf8')
    ) as StockInfo
    expect(stock.input.kind).toBe(kind)
    expect(stock.device).toBe('testdev')
    expect(stock.romVersion).toBe('TEST.1.0')
    expect(stock.super).toMatchObject({
      metadataMaxSize: 65536,
      metadataSlotCount: 3,
      virtualAb: true
    })
    expect(stock.partitions.map((p) => [p.name, p.lpName, p.kind, p.extracted])).toEqual([
      ['system', 'system_a', 'erofs', true],
      ['vendor', 'vendor_a', 'erofs', true]
    ])
    expect(stock.firmware.sort()).toEqual(['flash_all.sh', 'images/boot.img', 'misc.txt'])
    const fs = join(project, 'stock', 'fs')
    expect(readFileSync(join(fs, 'vendor', 'etc', 'fixture.txt'), 'utf8')).toBe('vendor fixture\n')
    // extract.erofs names config files after the image, so the slot suffix must be gone.
    expect(existsSync(join(fs, 'config', 'system_fs_config'))).toBe(true)
    expect(existsSync(join(fs, 'config', 'system_file_contexts'))).toBe(true)
    expect(stock.props.find((p) => p.partition === 'system')?.path).toBe('system/build.prop')

    const inv = JSON.parse(
      await readFile(join(project, 'stock', 'inventory.json'), 'utf8')
    ) as Inventory
    expect(inv.apks).toEqual([
      expect.objectContaining({
        partition: 'system',
        path: 'system/app/Test/Test.apk',
        packageName: 'com.example.test',
        versionCode: 42,
        versionName: '4.2',
        schemes: ['v3'],
        signerSha256: createHash('sha256').update(TEST_CERT).digest('hex'),
        error: null
      })
    ])
    const meta = JSON.parse(await readFile(join(project, 'project.json'), 'utf8')) as ProjectMeta
    expect(meta.device).toBe('testdev')
    // The input is never modified.
    expect(existsSync(join(rom, 'images', 'super.img'))).toBe(true)
    return stock
  }

  it('unpacks an extracted fastboot folder', async () => {
    const projects = join(tmp, 'projects')
    const p = await createProject(projects, 'folder')
    const r = await unpack(ctx(projects), { projectPath: p.path, input: rom, reset: false })
    expect(r).toMatchObject({ device: 'testdev', partitions: 2, extracted: 2, apks: 1 })
    const stock = await check(p.path, 'folder')
    expect(stock.input.sha256).toBeNull()
    // A second unpack must be explicit.
    await expect(
      unpack(ctx(projects), { projectPath: p.path, input: rom, reset: false })
    ).rejects.toThrow(/already unpacked/)
    await unpack(ctx(projects), { projectPath: p.path, input: rom, reset: true })
    await check(p.path, 'folder')
  }, 60_000)

  it('unpacks a fastboot tgz and records its sha256', async () => {
    const tgz = join(tmp, 'rom.tgz')
    const projects = join(tmp, 'projects')
    const p = await createProject(projects, 'tgz')
    await unpack(ctx(projects), { projectPath: p.path, input: tgz, reset: false })
    const stock = await check(p.path, 'fastboot-tgz')
    expect(stock.input.sha256).toBe(createHash('sha256').update(readFileSync(tgz)).digest('hex'))
    // The temporary extraction is removed once stock/ is complete.
    expect(readdirSync(join(p.path, 'source'))).toEqual([])
  }, 60_000)

  it('cancels cleanly while extracting an archive', async () => {
    const tgz = join(tmp, 'rom.tgz')
    const projects = join(tmp, 'projects')
    const p = await createProject(projects, 'cancel')
    const ac = new AbortController()
    ac.abort()
    // The background hash and the read stream must not leak an unhandled rejection.
    await expect(
      unpack(ctx(projects, ac), { projectPath: p.path, input: tgz, reset: false })
    ).rejects.toThrow(/cancelled/)
  })

  it('refuses an input inside the project', async () => {
    const projects = join(tmp, 'projects')
    const p = await createProject(projects, 'inside')
    await expect(
      unpack(ctx(projects), { projectPath: p.path, input: join(p.path, 'source'), reset: false })
    ).rejects.toThrow(/outside the project/)
  })
})
