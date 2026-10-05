// Branding media (M9): image headers, bootanimation desc.txt, a static animation from one
// image, and the stored-only rewrite.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OperationSchema } from '../../src/shared/recipe'
import { imageInfo } from '../../src/worker/formats/image'
import { ZipFile } from '../../src/worker/formats/zip'
import { storedZip } from '../../src/worker/formats/zipwrite'
import {
  inspectBootanimation,
  parseDesc,
  restoreStored,
  staticBootanimation
} from '../../src/worker/recipe/media'

let tmp: string
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-media-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}

function jpeg(w: number, h: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.alloc(9),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff])
  ])
}

describe('image headers', () => {
  it('reads PNG and JPEG size, rejects others', () => {
    expect(imageInfo(png(1280, 2772))).toEqual({ type: 'png', width: 1280, height: 2772 })
    expect(imageInfo(jpeg(1080, 2400))).toEqual({ type: 'jpeg', width: 1080, height: 2400 })
    expect(imageInfo(Buffer.from('not an image'))).toBeNull()
  })
})

describe('bootanimation desc.txt', () => {
  it('parses the header, parts and colours', () => {
    const { desc, problems } = parseDesc(
      '1280 2772 60 1\np 0 5 part0\nc 1 0 part1 #ff0000\n$SYSTEM\n'
    )
    expect(problems).toEqual([])
    expect(desc).toMatchObject({ width: 1280, height: 2772, fps: 60 })
    expect(desc?.parts.map((p) => p.type)).toEqual(['p', 'c', '$SYSTEM'])
    expect(desc?.parts[1].background).toBe('#ff0000')
  })
  it('flags a bad header and a bad colour', () => {
    expect(parseDesc('oops\n').desc).toBeNull()
    expect(parseDesc('100 100 30\np 0 0 part0 red\n').problems.join()).toMatch(/#RRGGBB/)
  })
})

describe('static bootanimation', () => {
  it('builds a stored zip with a one-frame loop', async () => {
    const z = staticBootanimation(png(720, 1600), '#112233')
    const f = join(tmp, 'static.zip')
    await writeFile(f, z)
    const zf = await ZipFile.open(f)
    expect([...zf.entries.keys()]).toEqual(['desc.txt', 'part0/00000.png'])
    expect([...zf.entries.values()].every((e) => e.method === 0)).toBe(true)
    expect((await zf.read('desc.txt'))?.toString()).toBe('720 1600 1\np 0 0 part0 #112233\n')
    await zf.close()
    const rep = await inspectBootanimation(f)
    expect(rep.problems).toEqual([])
    expect(rep.frames).toBe(1)
    expect(() => staticBootanimation(Buffer.from('x'), '#000000')).toThrow(/image/)
    expect(() => staticBootanimation(png(1, 1), 'black')).toThrow(/#RRGGBB/)
  })
})

describe('inspect and restore', () => {
  it('reports compressed entries and rewrites them stored', async () => {
    const frame = png(64, 64)
    const compressed = join(tmp, 'c.zip')
    // A real deflate of the frame, patched into a method-8 entry via storedZip then re-deflate.
    await writeFile(
      compressed,
      storedZip([
        { name: 'desc.txt', data: Buffer.from('64 64 30\np 0 0 part0\n') },
        { name: 'part0/0.png', data: frame }
      ])
    )
    const ok = await inspectBootanimation(compressed)
    expect(ok.problems).toEqual([])
    expect(ok.compressedEntries).toBe(0)

    // A zip with a mismatched frame size is a problem.
    await writeFile(
      join(tmp, 'bad.zip'),
      storedZip([
        { name: 'desc.txt', data: Buffer.from('64 64 30\np 0 0 part0\n') },
        { name: 'part0/0.png', data: png(32, 32) }
      ])
    )
    const bad = await inspectBootanimation(join(tmp, 'bad.zip'))
    expect(bad.problems.join()).toMatch(/32x32/)

    // restoreStored keeps the entries and order, all stored.
    const out = await restoreStored(compressed)
    await writeFile(join(tmp, 'r.zip'), out)
    const z = await ZipFile.open(join(tmp, 'r.zip'))
    expect([...z.entries.keys()]).toEqual(['desc.txt', 'part0/0.png'])
    await z.close()
  })
})

describe('media operation schema', () => {
  it('requires at least one target and an absolute path', () => {
    const ok = OperationSchema.parse({
      id: 'm',
      type: 'media',
      params: { wallpaper: { file: '/x/a.png', sha256: 'a'.repeat(64) } }
    })
    expect(ok.enabled).toBe(true)
    expect(() => OperationSchema.parse({ id: 'm', type: 'media', params: {} })).toThrow()
    expect(() =>
      OperationSchema.parse({
        id: 'm',
        type: 'media',
        params: { wallpaper: { file: 'rel.png', sha256: 'a'.repeat(64) } }
      })
    ).toThrow()
  })
})
