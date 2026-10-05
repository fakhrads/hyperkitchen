// GApps (M5): overlayfs runtime view, privapp allowlist check, MindTheGapps path rules and
// streaming zip extraction.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ZipFile } from '../../src/worker/formats/zip'
import {
  checkPrivapp,
  parsePrivappXml,
  privilegedPermissions,
  requestedPermissions
} from '../../src/worker/privapp'
import { gappsTreePath, unitOf } from '../../src/worker/recipe/gapps'
import { devToTree, parseFstabOverlays, RuntimeView } from '../../src/worker/runtimeview'
import { axml, zip } from '../fixtures/apk'

let tmp: string
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-gapps-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const ANDROID = 'android'
const NAME = 0x01010003
const LEVEL = 0x01010009
const MAX_SDK = 0x01010271

describe('runtime view', () => {
  const fstab = [
    '# comment',
    'mi_ext /mnt/vendor/mi_ext erofs ro wait,logical',
    'overlay /product/priv-app overlay ro,lowerdir=/mnt/vendor/mi_ext/product/priv-app/:/product/priv-app check,nofail',
    'overlay /system/etc/permissions overlay ro,lowerdir=/mnt/vendor/mi_ext/system/etc/permissions/:/product/pangu/system/etc/permissions/:/system/etc/permissions check,nofail',
    'overlay /product/usr overlay ro,lowerdir=/mnt/vendor/mi_ext/product/usr:product/usr check'
  ].join('\n')

  it('parses overlay lines and maps device paths to trees', () => {
    const m = parseFstabOverlays(fstab)
    expect(m.map((x) => x.target)).toEqual([
      '/product/priv-app',
      '/system/etc/permissions',
      '/product/usr'
    ])
    expect(m[1].lowers).toEqual([
      '/mnt/vendor/mi_ext/system/etc/permissions',
      '/product/pangu/system/etc/permissions',
      '/system/etc/permissions'
    ])
    expect(m[2].lowers[1]).toBe('/product/usr') // relative lowerdir in the stock fstab
    const parts = ['system', 'product', 'mi_ext']
    expect(devToTree('/system/etc/permissions', parts)).toBe('system/system/etc/permissions')
    expect(devToTree('/mnt/vendor/mi_ext/product/priv-app', parts)).toBe('mi_ext/product/priv-app')
    expect(devToTree('/vendor/etc', parts)).toBeNull()
  })

  it('lists the top layer first', async () => {
    const root = join(tmp, 'rv')
    for (const d of [
      'vendor/etc',
      'mi_ext/product/priv-app/A',
      'product/priv-app/A',
      'product/priv-app/B'
    ])
      await mkdir(join(root, d), { recursive: true })
    await writeFile(join(root, 'vendor/etc/fstab.qcom'), fstab)
    const v = await RuntimeView.open(root, ['vendor', 'mi_ext', 'product', 'system'])
    const l = await v.list('/product/priv-app')
    expect(l.get('A')?.tree).toBe('mi_ext/product/priv-app/A')
    expect(l.get('B')?.tree).toBe('product/priv-app/B')
  })
})

describe('privapp allowlist', () => {
  const platform = axml([
    { name: 'manifest', attrs: [{ name: 'package', str: 'android' }], children: 3 },
    {
      name: 'permission',
      attrs: [
        { ns: ANDROID, name: 'name', resId: NAME, str: 'android.permission.PRIV' },
        { ns: ANDROID, name: 'protectionLevel', resId: LEVEL, int: 0x12 }
      ]
    },
    {
      name: 'permission',
      attrs: [
        { ns: ANDROID, name: 'name', resId: NAME, str: 'android.permission.SIG' },
        { ns: ANDROID, name: 'protectionLevel', resId: LEVEL, int: 0x2 }
      ]
    },
    {
      name: 'permission',
      attrs: [
        { ns: ANDROID, name: 'name', resId: NAME, str: 'android.permission.OLD' },
        { ns: ANDROID, name: 'protectionLevel', resId: LEVEL, int: 0x12 }
      ]
    }
  ])
  const app = (pkg: string): Buffer =>
    axml([
      { name: 'manifest', attrs: [{ name: 'package', str: pkg }], children: 3 },
      {
        name: 'uses-permission',
        attrs: [{ ns: ANDROID, name: 'name', resId: NAME, str: 'android.permission.PRIV' }]
      },
      {
        name: 'uses-permission',
        attrs: [{ ns: ANDROID, name: 'name', resId: NAME, str: 'android.permission.SIG' }]
      },
      {
        name: 'uses-permission',
        attrs: [
          { ns: ANDROID, name: 'name', resId: NAME, str: 'android.permission.OLD' },
          { ns: ANDROID, name: 'maxSdkVersion', resId: MAX_SDK, int: 28 }
        ]
      }
    ])

  it('reads privileged permissions, requests and allowlists', () => {
    expect([...privilegedPermissions(platform)].sort()).toEqual([
      'android.permission.OLD',
      'android.permission.PRIV'
    ])
    expect(requestedPermissions(app('com.x'), 36)).toEqual({
      packageName: 'com.x',
      permissions: ['android.permission.PRIV', 'android.permission.SIG']
    })
    const xml = `<permissions>
      <!-- <privapp-permissions package="com.commented"><permission name="a"/></privapp-permissions> -->
      <privapp-permissions package="com.x">
        <permission name="android.permission.PRIV"/>
        <deny-permission name="android.permission.OTHER"/>
      </privapp-permissions>
    </permissions>`
    const m = parsePrivappXml(xml)
    expect([...m.keys()]).toEqual(['com.x'])
    expect([...(m.get('com.x') ?? [])]).toEqual([
      'android.permission.PRIV',
      'android.permission.OTHER'
    ])
  })

  it('finds a privileged app whose partition lacks the allowlist entry', async () => {
    const root = join(tmp, 'pa')
    const put = async (rel: string, data: Buffer | string): Promise<void> => {
      await mkdir(join(root, rel, '..'), { recursive: true })
      await writeFile(join(root, rel), data)
    }
    await put('system/system/framework/framework-res.apk', zip([['AndroidManifest.xml', platform]]))
    await put('system/system/build.prop', 'ro.build.version.sdk=36\n')
    await put('vendor/build.prop', 'ro.control_privapp_permissions=enforce\n')
    await put('system_ext/etc/build.prop', 'ro.control_privapp_permissions=disable\n')
    await put('product/priv-app/Good/Good.apk', zip([['AndroidManifest.xml', app('com.good')]]))
    await put('product/priv-app/Bad/Bad.apk', zip([['AndroidManifest.xml', app('com.bad')]]))
    await put(
      'product/etc/permissions/p.xml',
      '<permissions><privapp-permissions package="com.good"><permission name="android.permission.PRIV"/></privapp-permissions></permissions>'
    )
    // An entry on another partition does not count (SystemConfig keeps one list per partition).
    await put(
      'system/system/etc/permissions/s.xml',
      '<permissions><privapp-permissions package="com.bad"><permission name="android.permission.PRIV"/></privapp-permissions></permissions>'
    )
    const r = await checkPrivapp(root, ['system', 'system_ext', 'product', 'vendor'])
    expect(r?.enforced).toBe(true)
    expect(r?.modes).toEqual(['disable', 'enforce'])
    expect(r?.appsChecked).toBe(2)
    expect(r?.violations).toEqual([
      {
        scope: 'product',
        packageName: 'com.bad',
        apk: 'product/priv-app/Bad/Bad.apk',
        permission: 'android.permission.PRIV'
      }
    ])
    expect(await checkPrivapp(join(tmp, 'empty'), [])).toBeNull()
  })
})

describe('MindTheGapps layout', () => {
  it('maps zip entries and app units', () => {
    expect(gappsTreePath('system/product/priv-app/Phonesky/Phonesky.apk')).toBe(
      'product/priv-app/Phonesky/Phonesky.apk'
    )
    expect(gappsTreePath('system/system_ext/etc/permissions/x.xml')).toBe(
      'system_ext/etc/permissions/x.xml'
    )
    expect(gappsTreePath('system/addon.d/addond_head')).toBeNull()
    expect(gappsTreePath('META-INF/com/google/android/update-binary')).toBeNull()
    expect(gappsTreePath('toybox')).toBeNull()
    expect(unitOf('product/priv-app/Phonesky/Phonesky.apk')).toBe('product/priv-app/Phonesky')
    expect(unitOf('product/app/talkback/lib/arm64/x.so')).toBe('product/app/talkback')
    expect(unitOf('product/overlay/GmsOverlay.apk')).toBe('product/overlay/GmsOverlay.apk')
    expect(unitOf('product/etc/sysconfig/google.xml')).toBeNull()
  })
})

describe('zip extraction', () => {
  it('streams stored and deflated entries and checks the CRC', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7)
    const f = join(tmp, 'x.zip')
    await writeFile(
      f,
      zip([
        ['stored.bin', big],
        ['empty', Buffer.alloc(0)]
      ])
    )
    const z = await ZipFile.open(f)
    await z.extract('stored.bin', join(tmp, 'out.bin'))
    expect((await readFile(join(tmp, 'out.bin'))).equals(big)).toBe(true)
    await z.extract('empty', join(tmp, 'empty.out'))
    expect((await readFile(join(tmp, 'empty.out'))).length).toBe(0)
    await expect(z.extract('nope', join(tmp, 'n'))).rejects.toThrow(/no such entry/)
    await z.close()

    // A deflated entry: patch the fixture's stored entry into method 8 by hand.
    const data = Buffer.from('hello '.repeat(1000))
    const comp = deflateRawSync(data)
    const raw = zip([['d.txt', comp]])
    const crc = (await import('node:zlib')).crc32(data) >>> 0
    raw.writeUInt16LE(8, 8)
    raw.writeUInt32LE(crc, 14)
    raw.writeUInt32LE(data.length, 22)
    const cd = raw.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    raw.writeUInt16LE(8, cd + 10)
    raw.writeUInt32LE(crc, cd + 16)
    raw.writeUInt32LE(data.length, cd + 24)
    await writeFile(join(tmp, 'd.zip'), raw)
    const zd = await ZipFile.open(join(tmp, 'd.zip'))
    await zd.extract('d.txt', join(tmp, 'd.out'))
    expect(await readFile(join(tmp, 'd.out'), 'utf8')).toBe(data.toString())
    await zd.close()
    // Corrupt CRC is refused.
    raw.writeUInt32LE((crc ^ 1) >>> 0, cd + 16)
    await writeFile(join(tmp, 'bad.zip'), raw)
    const zb = await ZipFile.open(join(tmp, 'bad.zip'))
    await expect(zb.extract('d.txt', join(tmp, 'bad.out'))).rejects.toThrow(/CRC/)
    await zb.close()
  })
})
