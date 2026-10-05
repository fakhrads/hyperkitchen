// Simulates a recovery install of a real HyperKitchen package on the host: fake partitions as
// files, the updater built for the host, then checks what was written. Not part of pnpm test.
//   HK_BUILD_DIR=<project>/build/<id> HK_SIM=<dir> HK_UPDATER=<host updater>
//     npx vitest run --config tests/local/vitest.config.ts tests/local/recovery-sim.test.ts
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, open, rm, stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { BuildInfo } from '../../src/shared/types'
import { LP_SECTOR_SIZE, readLpMetadata } from '../../src/worker/formats/lp'
import { RawFileSource } from '../../src/worker/formats/source'
import { isSparseFile, SparseSource } from '../../src/worker/formats/sparse'
import type { InstallManifest } from '../../src/worker/package'

const buildDir = process.env.HK_BUILD_DIR as string
const sim = process.env.HK_SIM as string
const log = (s: string): void => appendFileSync(join(sim, 'sim.log'), s + '\n')

async function expandTo(image: string, dev: string, size: number): Promise<void> {
  await truncate(dev, 0).catch(() => {})
  writeFileSync(dev, '')
  await truncate(dev, size)
  const fh = await open(dev, 'r+')
  try {
    if (await isSparseFile(image)) {
      const s = await SparseSource.open([image])
      for (const e of s.extents) await fh.write(await s.read(e.start, e.len), 0, e.len, e.start)
      await s.close()
    } else {
      const b = readFileSync(image)
      await fh.write(b, 0, b.length, 0)
    }
  } finally {
    await fh.close()
  }
}

it('installs a real package onto fake partitions', async () => {
  await rm(sim + '/by-name', { recursive: true, force: true })
  await mkdir(join(sim, 'by-name'), { recursive: true })
  writeFileSync(join(sim, 'sim.log'), '')
  const info = JSON.parse(readFileSync(join(buildDir, 'build.json'), 'utf8')) as BuildInfo
  const zip = join(buildDir, info.zip as string)
  const m = JSON.parse(readFileSync(join(buildDir, 'hk-install.json'), 'utf8')) as InstallManifest
  const dev = (n: string): string => join(sim, 'by-name', n)

  // Firmware as the stock fastboot package left it, on both slots.
  const stockFw = join(buildDir, '..', '..', 'stock', 'firmware')
  const steps = readFileSync(join(stockFw, 'flash_all_except_storage.sh'), 'utf8')
  for (const fw of m.firmware) {
    const file = steps.match(
      new RegExp(`flash ${fw.partition}_ab \`dirname \\$0\`/(images/\\S+)`)
    )?.[1]
    if (!file) throw new Error(`no stock image for ${fw.partition}`)
    const img = join(stockFw, file)
    const size = (await isSparseFile(img))
      ? await SparseSource.open([img]).then(async (s) => (await s.close(), s.size))
      : (await stat(img)).size
    for (const slot of ['a', 'b']) await expandTo(img, dev(`${fw.partition}_${slot}`), size + 65536)
  }
  for (const w of m.write) {
    for (const slot of w.slots) {
      writeFileSync(dev(`${w.partition}_${slot}`), '')
      await truncate(dev(`${w.partition}_${slot}`), 128 * 1024 * 1024)
    }
  }
  writeFileSync(dev('recovery_a'), 'custom recovery A')
  writeFileSync(dev('recovery_b'), 'custom recovery B')
  writeFileSync(dev('super'), '')
  await truncate(dev('super'), 11811160064)
  writeFileSync(join(sim, 'getprop'), '#!/bin/sh\n[ "$1" = ro.product.device ] && echo onyx\n', {
    mode: 0o755
  })
  writeFileSync(join(sim, 'bootctl'), `#!/bin/sh\necho "$@" > ${join(sim, 'bootctl.log')}\n`, {
    mode: 0o755
  })
  writeFileSync(join(sim, 'mounts'), 'tmpfs /tmp tmpfs rw 0 0\n')

  const status = openSync(join(sim, 'status.log'), 'w')
  const t0 = Date.now()
  const r = spawnSync(process.env.HK_UPDATER as string, ['3', '3', zip], {
    stdio: ['ignore', 'pipe', 'pipe', status],
    env: {
      ...process.env,
      HK_UPDATER_BLOCK_DIR: join(sim, 'by-name'),
      HK_UPDATER_GETPROP: join(sim, 'getprop'),
      HK_UPDATER_BOOTCTL: join(sim, 'bootctl'),
      HK_UPDATER_MOUNTS: join(sim, 'mounts')
    },
    maxBuffer: 64 * 1024 * 1024
  })
  closeSync(status)
  log(`updater exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  log(
    readFileSync(join(sim, 'status.log'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('ui_print ') && l.length > 9)
      .join('\n')
  )
  expect(r.status, r.stderr.toString()).toBe(0)

  // Boot chain on both slots equals the package images; recovery untouched.
  for (const w of m.write) {
    const img = readFileSync(join(buildDir, w.entry))
    for (const slot of w.slots) {
      const fh = await open(dev(`${w.partition}_${slot}`), 'r')
      const b = Buffer.alloc(img.length)
      await fh.read(b, 0, b.length, 0)
      await fh.close()
      expect(b.equals(img), `${w.partition}_${slot}`).toBe(true)
    }
  }
  expect(readFileSync(dev('recovery_a'), 'utf8')).toBe('custom recovery A')
  expect(readFileSync(join(sim, 'bootctl.log'), 'utf8').trim()).toBe('set-active-boot-slot 0')

  // The super partition now holds the built layout and every partition's exact data.
  const src = await RawFileSource.open(dev('super'))
  try {
    const lp = await readLpMetadata(src)
    for (const p of info.partitions) {
      const part = lp.partitions.find((x) => x.name === p.lpName)
      expect(part?.size, p.lpName).toBe(p.size)
      const h = createHash('sha256')
      for (const e of part!.extents) {
        const len = e.numSectors * LP_SECTOR_SIZE
        for (let o = 0; o < len; o += 8 << 20) {
          h.update(await src.read(e.targetData * LP_SECTOR_SIZE + o, Math.min(8 << 20, len - o)))
        }
      }
      expect(h.digest('hex'), p.lpName).toBe(p.sha256)
      log(`${p.lpName}: matches the built image`)
    }
  } finally {
    await src.close()
  }
}, 7_200_000)
