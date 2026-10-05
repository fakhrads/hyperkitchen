// A tiny but structurally real fastboot ROM: images/super.img built by lpmake (sparse, virtual
// A/B, slot a filled) holding erofs partitions built by mkfs.erofs, plus a boot image header,
// misc.txt and a flash script. Used by the unpack unit and e2e tests.
import { randomBytes } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from '../../src/worker/spawn'
import { axml, der, schemeBlock, signingBlock, zip } from './apk'

export const TEST_CERT = der(0x30, der(0x30, randomBytes(120)), der(0x03, randomBytes(48)))
const V3_ID = 0xf05368c0

export function testApk(pkg: string, versionCode: number, versionName: string): Buffer {
  const manifest = axml([
    {
      name: 'manifest',
      attrs: [
        { ns: 'android', name: 'versionCode', resId: 0x0101021b, int: versionCode },
        { ns: 'android', name: 'versionName', resId: 0x0101021c, str: versionName },
        { name: 'package', str: pkg }
      ]
    }
  ])
  return zip(
    [['AndroidManifest.xml', manifest]],
    signingBlock([[V3_ID, schemeBlock(TEST_CERT, true)]])
  )
}

const MiB = 1024 * 1024

async function mkErofs(binDir: string, srcDir: string, out: string): Promise<number> {
  // mkfs.erofs [OPTIONS] FILE SOURCE (mkfs.erofs --help); -T0 fixed timestamp for reproducibility.
  const r = await run(join(binDir, 'mkfs.erofs'), ['-T0', out, srcDir])
  if (r.code !== 0) throw new Error(`mkfs.erofs: ${r.output}`)
  return Math.ceil((await stat(out)).size / MiB) * MiB
}

/** Writes <dir>/images/*, misc.txt and flash_all.sh. Returns the ROM folder. */
export async function buildFastbootRom(dir: string, binDir: string): Promise<string> {
  const work = join(dir, 'work')
  const rom = join(dir, 'rom')
  const images = join(rom, 'images')
  await mkdir(images, { recursive: true })

  // system-as-root layout: the partition root holds system/build.prop.
  const sys = join(work, 'system')
  await mkdir(join(sys, 'system', 'app', 'Test'), { recursive: true })
  await writeFile(
    join(sys, 'system', 'build.prop'),
    'ro.build.version.incremental=TEST.1.0\nro.product.system.device=generic\n'
  )
  await writeFile(
    join(sys, 'system', 'app', 'Test', 'Test.apk'),
    testApk('com.example.test', 42, '4.2')
  )
  const ven = join(work, 'vendor')
  await mkdir(join(ven, 'etc'), { recursive: true })
  await writeFile(join(ven, 'build.prop'), 'ro.product.vendor.device=mivendor\n')
  await writeFile(join(ven, 'etc', 'fixture.txt'), 'vendor fixture\n')

  const sysImg = join(work, 'system.img')
  const venImg = join(work, 'vendor.img')
  const sysSize = await mkErofs(binDir, sys, sysImg)
  const venSize = await mkErofs(binDir, ven, venImg)
  const group = 8 * MiB
  // Flags from `lpmake --help`.
  const r = await run(join(binDir, 'lpmake'), [
    '--metadata-size',
    '65536',
    '--metadata-slots',
    '3',
    '--device-size',
    String(32 * MiB),
    '--super-name',
    'super',
    '--group',
    `main_a:${group}`,
    '--group',
    `main_b:${group}`,
    '--partition',
    `system_a:readonly:${sysSize}:main_a`,
    '--partition',
    `vendor_a:readonly:${venSize}:main_a`,
    '--partition',
    'system_b:readonly:0:main_b',
    '--partition',
    'vendor_b:readonly:0:main_b',
    '--image',
    `system_a=${sysImg}`,
    '--image',
    `vendor_a=${venImg}`,
    '--virtual-ab',
    '--sparse',
    '--output',
    join(images, 'super.img')
  ])
  if (r.code !== 0) throw new Error(`lpmake: ${r.output}`)

  const boot = Buffer.alloc(8192)
  boot.write('ANDROID!', 0, 'latin1')
  await writeFile(join(images, 'boot.img'), boot)
  await writeFile(join(rom, 'misc.txt'), 'device=testdev\nbuild_number=TEST.1.0.FIXTURE\n')
  await writeFile(join(rom, 'flash_all.sh'), '# fixture\n')
  return rom
}
