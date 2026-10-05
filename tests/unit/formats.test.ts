// Binary format readers used by the unpack job. Fixtures are generated here; when the pinned
// binaries are fetched, sparse and super images are also produced by the real AOSP tools
// (img2simg, lpmake) so the readers are checked against an independent implementation.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformKey } from '../../src/shared/platform'
import { readSigner, firstPkcs7Cert, V2_ID, V3_ID } from '../../src/worker/formats/apksig'
import { readManifest } from '../../src/worker/formats/axml'
import { parseProps, propMap } from '../../src/worker/formats/buildprop'
import { detectKind } from '../../src/worker/formats/fstype'
import { LP_SECTOR_SIZE, readLpMetadata } from '../../src/worker/formats/lp'
import { RawFileSource } from '../../src/worker/formats/source'
import { SparseSource } from '../../src/worker/formats/sparse'
import { ZipFile } from '../../src/worker/formats/zip'
import { run } from '../../src/worker/spawn'
import { partitionFileNames } from '../../src/worker/unpack'
import { axml, der, schemeBlock, signingBlock, zip } from '../fixtures/apk'

let tmp: string
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-fmt-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const BLK = 4096

// ------------------------------------------------------------------ sparse

type Chunk =
  | { t: 'raw'; data: Buffer }
  | { t: 'fill'; blocks: number; value: number }
  | { t: 'skip'; blocks: number }
  | { t: 'crc' }

function sparse(totalBlks: number, chunks: Chunk[]): Buffer {
  const parts: Buffer[] = []
  const h = Buffer.alloc(28)
  h.writeUInt32LE(0xed26ff3a, 0)
  h.writeUInt16LE(1, 4)
  h.writeUInt16LE(0, 6)
  h.writeUInt16LE(28, 8)
  h.writeUInt16LE(12, 10)
  h.writeUInt32LE(BLK, 12)
  h.writeUInt32LE(totalBlks, 16)
  h.writeUInt32LE(chunks.length, 20)
  parts.push(h)
  for (const c of chunks) {
    const ch = Buffer.alloc(12)
    if (c.t === 'raw') {
      ch.writeUInt16LE(0xcac1, 0)
      ch.writeUInt32LE(c.data.length / BLK, 4)
      ch.writeUInt32LE(12 + c.data.length, 8)
      parts.push(ch, c.data)
    } else if (c.t === 'fill') {
      ch.writeUInt16LE(0xcac2, 0)
      ch.writeUInt32LE(c.blocks, 4)
      ch.writeUInt32LE(16, 8)
      const v = Buffer.alloc(4)
      v.writeUInt32LE(c.value)
      parts.push(ch, v)
    } else if (c.t === 'skip') {
      ch.writeUInt16LE(0xcac3, 0)
      ch.writeUInt32LE(c.blocks, 4)
      ch.writeUInt32LE(12, 8)
      parts.push(ch)
    } else {
      ch.writeUInt16LE(0xcac4, 0)
      ch.writeUInt32LE(0, 4)
      ch.writeUInt32LE(16, 8)
      parts.push(ch, Buffer.alloc(4))
    }
  }
  return Buffer.concat(parts)
}

describe('sparse reader', () => {
  it('expands raw, fill, dont-care and crc chunks', async () => {
    const raw = randomBytes(2 * BLK)
    const tail = randomBytes(BLK)
    const file = join(tmp, 'a.simg')
    await writeFile(
      file,
      sparse(5, [
        { t: 'raw', data: raw },
        { t: 'fill', blocks: 1, value: 0xdeadbeef },
        { t: 'skip', blocks: 1 },
        { t: 'crc' },
        { t: 'raw', data: tail }
      ])
    )
    const s = await SparseSource.open([file])
    try {
      expect(s.size).toBe(5 * BLK)
      const all = await s.read(0, s.size)
      expect(all.subarray(0, 2 * BLK).equals(raw)).toBe(true)
      const fill = Buffer.alloc(BLK)
      for (let i = 0; i < BLK; i += 4) fill.writeUInt32LE(0xdeadbeef, i)
      expect(all.subarray(2 * BLK, 3 * BLK).equals(fill)).toBe(true)
      expect(all.subarray(3 * BLK, 4 * BLK).every((b) => b === 0)).toBe(true)
      expect(all.subarray(4 * BLK).equals(tail)).toBe(true)
      // Unaligned reads across extent boundaries, including mid-fill pattern phase.
      expect((await s.read(2 * BLK - 3, 9)).equals(all.subarray(2 * BLK - 3, 2 * BLK + 6))).toBe(
        true
      )
      expect((await s.read(5 * BLK - 2, 8)).subarray(2).every((b) => b === 0)).toBe(true)
    } finally {
      await s.close()
    }
  })

  it('reads a split set as one image and rejects overlap', async () => {
    const a = randomBytes(BLK)
    const b = randomBytes(2 * BLK)
    const p0 = join(tmp, 's.img.0')
    const p1 = join(tmp, 's.img.1')
    await writeFile(
      p0,
      sparse(4, [
        { t: 'raw', data: a },
        { t: 'skip', blocks: 3 }
      ])
    )
    await writeFile(
      p1,
      sparse(4, [
        { t: 'skip', blocks: 2 },
        { t: 'raw', data: b }
      ])
    )
    const s = await SparseSource.open([p0, p1])
    try {
      const all = await s.read(0, s.size)
      expect(all.subarray(0, BLK).equals(a)).toBe(true)
      expect(all.subarray(BLK, 2 * BLK).every((x) => x === 0)).toBe(true)
      expect(all.subarray(2 * BLK).equals(b)).toBe(true)
    } finally {
      await s.close()
    }
    await expect(SparseSource.open([p0, p0])).rejects.toThrow(/overlap/)

    // Parts may describe different output sizes; the set is as large as the largest part.
    const q0 = join(tmp, 't.img.0')
    const q1 = join(tmp, 't.img.1')
    await writeFile(q0, sparse(1, [{ t: 'raw', data: a }]))
    await writeFile(
      q1,
      sparse(3, [
        { t: 'skip', blocks: 1 },
        { t: 'raw', data: b }
      ])
    )
    const t = await SparseSource.open([q0, q1])
    try {
      expect(t.size).toBe(3 * BLK)
      expect((await t.read(0, t.size)).equals(Buffer.concat([a, b]))).toBe(true)
    } finally {
      await t.close()
    }
  })

  it('rejects a chunk table that does not cover the header block count', async () => {
    const file = join(tmp, 'bad.simg')
    await writeFile(file, sparse(3, [{ t: 'skip', blocks: 2 }]))
    await expect(SparseSource.open([file])).rejects.toThrow(/cover/)
  })
})

// ------------------------------------------------------------------ real AOSP tools

const key = platformKey(process.platform, process.arch)
const binDir = key ? join(resolve(__dirname, '../..'), 'resources/bin', key) : ''
const haveBins = !!key && existsSync(binDir) && readdirSync(binDir).includes('lpmake')

describe.runIf(haveBins)('cross-check with AOSP tools', () => {
  it('reads what img2simg writes', async () => {
    // Mix of data, zero runs and a repeated pattern so img2simg emits raw, dont-care and fill.
    const raw = Buffer.alloc(64 * BLK)
    randomBytes(5 * BLK).copy(raw, 0)
    raw.fill(0x5a, 20 * BLK, 30 * BLK)
    randomBytes(3 * BLK + 100).copy(raw, 40 * BLK)
    const rawPath = join(tmp, 'x.raw')
    const simg = join(tmp, 'x.simg')
    await writeFile(rawPath, raw)
    const r = await run(join(binDir, 'img2simg'), [rawPath, simg])
    expect(r.code, r.output).toBe(0)
    const s = await SparseSource.open([simg])
    try {
      expect(s.size).toBe(raw.length)
      expect((await s.read(0, s.size)).equals(raw)).toBe(true)
      expect(new Set(s.extents.map((e) => e.kind))).toEqual(new Set(['raw', 'fill']))
    } finally {
      await s.close()
    }
  })

  it('reads the geometry, layout and partition data that lpmake writes', async () => {
    const sys = randomBytes(1024 * 1024)
    const ven = randomBytes(2 * 1024 * 1024)
    await writeFile(join(tmp, 'sys.img'), sys)
    await writeFile(join(tmp, 'ven.img'), ven)
    const out = join(tmp, 'super.img')
    // Flags from `lpmake --help`.
    const r = await run(join(binDir, 'lpmake'), [
      '--metadata-size',
      '65536',
      '--metadata-slots',
      '3',
      '--device-size',
      String(16 * 1024 * 1024),
      '--super-name',
      'super',
      '--group',
      'main_a:8388608',
      '--group',
      'main_b:8388608',
      '--partition',
      'system_a:readonly:1048576:main_a',
      '--partition',
      'vendor_a:readonly:2097152:main_a',
      '--partition',
      'system_b:readonly:0:main_b',
      '--partition',
      'vendor_b:readonly:0:main_b',
      '--image',
      `system_a=${join(tmp, 'sys.img')}`,
      '--image',
      `vendor_a=${join(tmp, 'ven.img')}`,
      '--virtual-ab',
      '--sparse',
      '--output',
      out
    ])
    expect(r.code, r.output).toBe(0)
    const s = await SparseSource.open([out])
    try {
      expect(detectKind(await s.read(0, 8192))).toBe('super')
      const m = await readLpMetadata(s)
      expect(m.geometry).toEqual({
        metadataMaxSize: 65536,
        metadataSlotCount: 3,
        logicalBlockSize: 4096
      })
      expect(m.headerFlags & 1).toBe(1)
      expect(m.blockDevices[0]).toMatchObject({ partitionName: 'super', size: 16 * 1024 * 1024 })
      expect(m.groups.map((g) => g.name)).toEqual(['default', 'main_a', 'main_b'])
      const byName = Object.fromEntries(m.partitions.map((p) => [p.name, p]))
      expect(byName.system_a).toMatchObject({
        size: sys.length,
        groupName: 'main_a',
        attributes: 1
      })
      expect(byName.vendor_b.size).toBe(0)
      for (const [name, data] of [
        ['system_a', sys],
        ['vendor_a', ven]
      ] as const) {
        const parts: Buffer[] = []
        for (const e of byName[name].extents) {
          parts.push(await s.read(e.targetData * LP_SECTOR_SIZE, e.numSectors * LP_SECTOR_SIZE))
        }
        expect(Buffer.concat(parts).equals(data)).toBe(true)
      }
      expect([...partitionFileNames(m)]).toEqual([
        ['system_a', 'system'],
        ['vendor_a', 'vendor']
      ])
    } finally {
      await s.close()
    }
  })
})

// ------------------------------------------------------------------ AXML

const MANIFEST = axml([
  {
    name: 'manifest',
    children: 1,
    attrs: [
      { ns: 'android', name: 'versionCode', resId: 0x0101021b, int: 1234567 },
      { ns: 'android', name: 'versionName', resId: 0x0101021c, str: '15.0.1-test' },
      { ns: 'android', name: 'sharedUserId', resId: 0x0101000b, str: 'android.uid.system' },
      { name: 'package', str: 'com.example.app' }
    ]
  },
  { name: 'application', children: 1, attrs: [] },
  { name: 'uses-library', attrs: [{ ns: 'android', name: 'name', str: 'org.apache.http.legacy' }] }
])

describe('AXML manifest reader', () => {
  it('reads package, version, sharedUserId and uses-library', () => {
    expect(readManifest(MANIFEST)).toEqual({
      packageName: 'com.example.app',
      versionCode: 1234567,
      versionName: '15.0.1-test',
      sharedUserId: 'android.uid.system',
      usesLibraries: ['org.apache.http.legacy'],
      overlayTarget: null
    })
  })

  it('rejects non-AXML input', () => {
    expect(() => readManifest(Buffer.from('<manifest/>'))).toThrow(/binary XML/)
  })
})

// ------------------------------------------------------------------ zip + APK signer

describe('APK signer', () => {
  const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
  const certA = der(0x30, der(0x30, randomBytes(150)), der(0x03, randomBytes(64)))
  const certB = der(0x30, der(0x30, randomBytes(150)), der(0x03, randomBytes(64)))

  it('reads the v3 signer (preferred over v2) from the APK Signing Block', async () => {
    const p = join(tmp, 'v23.apk')
    await writeFile(
      p,
      zip(
        [['AndroidManifest.xml', MANIFEST]],
        signingBlock([
          [V2_ID, schemeBlock(certB, false)],
          [V3_ID, schemeBlock(certA, true)]
        ])
      )
    )
    const z = await ZipFile.open(p)
    try {
      expect((await z.read('AndroidManifest.xml'))?.equals(MANIFEST)).toBe(true)
      expect(await readSigner(z)).toEqual({ schemes: ['v2', 'v3'], certSha256: sha(certA) })
    } finally {
      await z.close()
    }
  })

  it('falls back to the v1 PKCS#7 certificate', async () => {
    const oid = der(0x06, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]))
    const signedData = der(
      0x30,
      der(0x02, Buffer.from([1])),
      der(0x31),
      der(0x30, der(0x06, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]))),
      der(0xa0, certA, certB),
      der(0x31)
    )
    const pkcs7 = der(0x30, oid, der(0xa0, signedData))
    expect(firstPkcs7Cert(pkcs7)?.equals(certA)).toBe(true)
    const p = join(tmp, 'v1.apk')
    await writeFile(
      p,
      zip([
        ['AndroidManifest.xml', MANIFEST],
        ['META-INF/CERT.RSA', pkcs7]
      ])
    )
    const z = await ZipFile.open(p)
    try {
      expect(await readSigner(z)).toEqual({ schemes: ['v1'], certSha256: sha(certA) })
    } finally {
      await z.close()
    }
  })

  it('reports an unsigned APK as such', async () => {
    const p = join(tmp, 'unsigned.apk')
    await writeFile(p, zip([['AndroidManifest.xml', MANIFEST]]))
    const z = await ZipFile.open(p)
    try {
      expect(await readSigner(z)).toEqual({ schemes: [], certSha256: null })
    } finally {
      await z.close()
    }
  })
})

// ------------------------------------------------------------------ misc

describe('build.prop and image kinds', () => {
  it('parses props, skipping comments and imports; last assignment wins', () => {
    const lines = parseProps(
      '# comment\nimport /odm/etc/build.prop\nro.a=1\nro.b = two words \nbad line\nro.a=3\n'
    )
    expect(propMap(lines)).toEqual({ 'ro.a': '3', 'ro.b': 'two words' })
  })

  it('detects image kinds from magic', async () => {
    const erofs = Buffer.alloc(8192)
    erofs.writeUInt32LE(0xe0f5e1e2, 1024)
    const ext4 = Buffer.alloc(8192)
    ext4.writeUInt16LE(0xef53, 1024 + 0x38)
    expect(detectKind(erofs)).toBe('erofs')
    expect(detectKind(ext4)).toBe('ext4')
    expect(detectKind(Buffer.concat([Buffer.from('ANDROID!'), Buffer.alloc(8184)]))).toBe('boot')
    expect(detectKind(Buffer.concat([Buffer.from('AVB0'), Buffer.alloc(8188)]))).toBe('vbmeta')
    expect(detectKind(Buffer.alloc(8192))).toBe('empty')
    const p = join(tmp, 'raw.img')
    await writeFile(p, erofs)
    const s = await RawFileSource.open(p)
    try {
      expect((await s.read(8190, 4)).equals(Buffer.alloc(4))).toBe(true)
    } finally {
      await s.close()
    }
    expect((await readFile(p)).length).toBe(8192)
  })
})
