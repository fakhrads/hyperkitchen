// M3: verity edits, flash scripts, and a full build of a synthetic ROM (needs `pnpm fetch-bins`).
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProject } from '../../src/main/projects'
import { platformKey } from '../../src/shared/platform'
import type { BuildInfo } from '../../src/shared/types'
import { build } from '../../src/worker/build'
import type { JobContext } from '../../src/worker/context'
import { parseErofsSuper } from '../../src/worker/formats/erofs'
import { readLpMetadata } from '../../src/worker/formats/lp'
import { SparseSource } from '../../src/worker/formats/sparse'
import { vbmetaFlags, withVbmetaFlags } from '../../src/worker/formats/vbmeta'
import { parseStockScript, referencedFiles, renderScript } from '../../src/worker/flashscript'
import { hasAvbFlags, stripAvbFlags } from '../../src/worker/fstab'
import { unpack } from '../../src/worker/unpack'
import { buildFastbootRom } from '../fixtures/rom'

describe('fstab avb flags', () => {
  // Lines taken from the onyx stock first-stage fstab.
  const stock = [
    '# comment avb=vbmeta stays',
    'system                  /system                erofs   ro          wait,slotselect,avb=vbmeta_system,logical,first_stage_mount,avb_keys=/avb/q-gsi.avbpubkey:/avb/r-gsi.avbpubkey',
    'mi_ext                 /mnt/vendor/mi_ext   erofs\t\tro          wait,slotselect,avb=vbmeta,logical,first_stage_mount,nofail',
    '/dev/block/by-name/boot  /boot  emmc  defaults  slotselect,avb=vbmeta,first_stage_mount',
    'userdata  /data  f2fs  noatime  latemount,wait,check',
    ''
  ].join('\n')

  it('removes avb, avb= and avb_keys= and keeps everything else byte for byte', () => {
    const r = stripAvbFlags(stock)
    expect(r.changed).toEqual([2, 3, 4])
    expect(r.text.split('\n')).toEqual([
      '# comment avb=vbmeta stays',
      'system                  /system                erofs   ro          wait,slotselect,logical,first_stage_mount',
      'mi_ext                 /mnt/vendor/mi_ext   erofs\t\tro          wait,slotselect,logical,first_stage_mount,nofail',
      '/dev/block/by-name/boot  /boot  emmc  defaults  slotselect,first_stage_mount',
      'userdata  /data  f2fs  noatime  latemount,wait,check',
      ''
    ])
    expect(hasAvbFlags(stock)).toBe(true)
    expect(hasAvbFlags(r.text)).toBe(false)
  })

  it('does not touch the mount options column', () => {
    const line = 'x /x erofs ro,avb=odd wait,avb'
    expect(stripAvbFlags(line).text).toBe('x /x erofs ro,avb=odd wait')
  })
})

describe('vbmeta and erofs headers', () => {
  it('sets the disable flags big endian at offset 120', () => {
    const b = Buffer.alloc(4096)
    b.write('AVB0', 0, 'latin1')
    const out = withVbmetaFlags(b, 3)
    expect(vbmetaFlags(out)).toBe(3)
    expect(out.readUInt32BE(120)).toBe(3)
    expect(out.subarray(124).equals(b.subarray(124))).toBe(true)
    expect(vbmetaFlags(b)).toBe(0)
    expect(() => vbmetaFlags(Buffer.alloc(4096))).toThrow(/AVB0/)
  })

  it('reads block size, epoch and uuid from an erofs superblock', () => {
    const sb = Buffer.alloc(128)
    sb.writeUInt32LE(0xe0f5e1e2, 0)
    sb[12] = 12
    sb.writeBigUInt64LE(1230768000n, 24)
    Buffer.from('9e3d169a6b135ec3b3f64be8afde2f3c', 'hex').copy(sb, 48)
    expect(parseErofsSuper(sb)).toEqual({
      blockSize: 4096,
      epoch: 1230768000,
      uuid: '9e3d169a-6b13-5ec3-b3f6-4be8afde2f3c',
      volumeName: ''
    })
  })
})

describe('flash scripts', () => {
  const stock = [
    'fastboot $* getvar product 2>&1 | grep -E  "^product: *onyx"',
    'ver=`fastboot $* getvar anti 2>&1 | grep -oP "anti: \\K[0-9]+"`',
    'fastboot $* getvar crc 2>&1 | grep "^crc: 1"',
    'fastboot $* flash crclist       `dirname $0`/images/crclist.txt',
    'fastboot $* flash sparsecrclist `dirname $0`/images/sparsecrclist.txt',
    'fastboot $* erase boot_ab',
    'fastboot $* flash abl_ab `dirname $0`/images/abl.elf',
    '# fastboot $* flash pdp_ab `dirname $0`/images/pdp.elf',
    'fastboot $* flash super `dirname $0`/images/super.img',
    'fastboot $* set_active a',
    'fastboot $* oem lock',
    'fastboot $* reboot'
  ].join('\n')

  it('keeps the flash order and drops CRC lists, comments, getvar and oem lock', () => {
    const steps = parseStockScript(stock)
    expect(steps).toEqual([
      { op: 'erase', args: ['boot_ab'] },
      { op: 'flash', args: ['abl_ab', 'images/abl.elf'] },
      { op: 'flash', args: ['super', 'images/super.img'] },
      { op: 'set_active', args: ['a'] },
      { op: 'reboot', args: [] }
    ])
    expect(referencedFiles(steps)).toEqual(['images/abl.elf', 'images/super.img'])
  })

  it('renders a portable script with device, unlock and anti-rollback checks', () => {
    const text = renderScript({
      device: 'onyx',
      antiVersionFile: true,
      wipesData: false,
      steps: parseStockScript(stock),
      generator: 'test'
    })
    expect(text.startsWith('#!/bin/sh\n')).toBe(true)
    expect(text).toContain(`[ "$product" = 'onyx' ]`)
    expect(text).toContain('[ "$unlocked" = "yes" ]')
    expect(text).toContain("run flash 'super' 'images/super.img'")
    expect(text).not.toMatch(/grep -oP|oem lock|crclist/)
    expect(text).toContain('keeps user data')
  })
})

// ------------------------------------------------------------------ full build

const root = resolve(__dirname, '../..')
const key = platformKey(process.platform, process.arch)
const binDir = key ? join(root, 'resources/bin', key) : ''
const haveBins = !!key && existsSync(binDir) && readdirSync(binDir).includes('lpmake')

describe.runIf(haveBins)('build', () => {
  let tmp: string
  let project: string
  const ctx = (): JobContext => ({
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

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'hk-build-'))
    const rom = await buildFastbootRom(join(tmp, 'fixture'), binDir)
    const p = await createProject(join(tmp, 'projects'), 'b')
    project = p.path
    await unpack(ctx(), { projectPath: project, input: rom, reset: false })
  }, 60_000)
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('rebuilds every partition, verifies it and writes a fastboot package', async () => {
    const info = await build(ctx(), {
      projectPath: project,
      verity: 'vbmeta-flags',
      verify: true,
      generator: 'test'
    })
    expect(info.status).toBe('done')
    expect(info.superVerified).toBe(true)
    expect(info.partitions.map((p) => [p.name, p.lpName, p.rebuilt, p.treeVerified])).toEqual([
      ['system', 'system_a', true, true],
      ['vendor', 'vendor_a', true, true]
    ])
    const out = join(project, 'build', info.id)
    const saved = JSON.parse(await readFile(join(out, 'build.json'), 'utf8')) as BuildInfo
    expect(saved.status).toBe('done')
    expect(existsSync(join(out, '.tmp'))).toBe(false)

    // super.img keeps the stock layout and holds exactly the built images.
    const s = await SparseSource.open([join(out, 'images', 'super.img')])
    try {
      const m = await readLpMetadata(s)
      expect(m.headerFlags & 1).toBe(1)
      expect(m.geometry.metadataSlotCount).toBe(3)
      expect(m.partitions.map((p) => p.name).sort()).toEqual([
        'system_a',
        'system_b',
        'vendor_a',
        'vendor_b'
      ])
    } finally {
      await s.close()
    }

    expect(vbmetaFlags(readFileSync(join(out, 'images', 'vbmeta.img')))).toBe(3)
    expect(info.verityChanges).toEqual(['vbmeta.img flags 0 -> 3'])
    expect(info.scripts).toEqual(['flash_all.sh', 'flash_all_except_storage.sh'])
    const keep = readFileSync(join(out, 'flash_all_except_storage.sh'), 'utf8')
    expect(keep).toContain('[ "$product" = \'testdev\' ]')
    expect(keep).not.toContain('erase metadata')
    expect(readFileSync(join(out, 'flash_all.sh'), 'utf8')).toContain("run erase 'metadata'")
    expect(keep).not.toMatch(/crclist/)
    expect(existsSync(join(out, 'images', 'sparsecrclist.txt'))).toBe(false)

    // Every listed checksum matches the file.
    const sums = readFileSync(join(out, 'checksums.sha256'), 'utf8').trim().split('\n')
    expect(sums.length).toBeGreaterThan(5)
    for (const l of sums) {
      const [hash, rel] = l.split('  ')
      expect(
        createHash('sha256')
          .update(readFileSync(join(out, rel)))
          .digest('hex')
      ).toBe(hash)
    }
  }, 120_000)

  it('refuses to build when the recipe has operations (M4)', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      join(project, 'recipe.json'),
      JSON.stringify({ schema: 1, operations: [{ id: 'x' }] })
    )
    await expect(
      build(ctx(), { projectPath: project, verity: 'fstab', verify: false, generator: 't' })
    ).rejects.toThrow(/recipe operations/)
    await writeFile(join(project, 'recipe.json'), JSON.stringify({ schema: 1, operations: [] }))
  })
})
