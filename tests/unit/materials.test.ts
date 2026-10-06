// Materials library: register reference ROMs and images by path, validated and hashed, stored
// in settings (files are never copied).
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addMaterial, listMaterials, removeMaterial } from '../../src/main/materials'
import { SettingsStore } from '../../src/main/settings'

let tmp: string
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-mat-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function store(): SettingsStore {
  return new SettingsStore(join(tmp, `s${Math.random().toString(36).slice(2)}.json`), () => ({
    schema: 1,
    projectsRoot: '/x',
    javaPath: '',
    recentProjects: [],
    materials: []
  }))
}

// A 1x1 PNG header is enough for imageInfo.
function png(): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(64, 16)
  b.writeUInt32BE(64, 20)
  return b
}

describe('materials library', () => {
  it('registers a reference ROM and an image, dedupes by path, and removes', async () => {
    const s = store()
    // Reference ROM: an unpacked project folder with stock/stock.json.
    const proj = join(tmp, 'ref-proj')
    await mkdir(join(proj, 'stock'), { recursive: true })
    await writeFile(
      join(proj, 'stock', 'stock.json'),
      JSON.stringify({ device: 'onyx', romVersion: 'OS3.0.305.0.WOLCNXM' })
    )
    const ref = await addMaterial(s, { kind: 'reference-rom', path: proj, label: '' })
    expect(ref.kind).toBe('reference-rom')
    expect(ref.label).toContain('onyx')
    expect(ref.meta?.romVersion).toBe('OS3.0.305.0.WOLCNXM')
    expect(ref.sha256).toBeUndefined()

    const imgPath = join(tmp, 'logo.png')
    await writeFile(imgPath, png())
    const img = await addMaterial(s, { kind: 'image', path: imgPath, label: 'My logo' })
    expect(img.label).toBe('My logo')
    expect(img.meta).toEqual({ type: 'png', size: '64x64' })
    expect(img.sha256).toBe(createHash('sha256').update(png()).digest('hex'))

    expect(await listMaterials(s)).toHaveLength(2)
    // Re-adding the same path+kind replaces rather than duplicates.
    await addMaterial(s, { kind: 'image', path: imgPath, label: 'renamed' })
    const list = await listMaterials(s)
    expect(list.filter((m) => m.kind === 'image')).toHaveLength(1)
    expect(list.find((m) => m.kind === 'image')?.label).toBe('renamed')

    await removeMaterial(s, ref.id)
    expect((await listMaterials(s)).map((m) => m.kind)).toEqual(['image'])
  })

  it('refuses a missing path, a non-project folder, and a non-image', async () => {
    const s = store()
    await expect(addMaterial(s, { kind: 'image', path: '/nope/x.png', label: '' })).rejects.toThrow(
      /no such file/
    )
    const notProj = join(tmp, 'empty-dir')
    await mkdir(notProj, { recursive: true })
    await expect(
      addMaterial(s, { kind: 'reference-rom', path: notProj, label: '' })
    ).rejects.toThrow(/not an unpacked project/)
    const notImg = join(tmp, 'x.png')
    await writeFile(notImg, Buffer.from('not a png'))
    await expect(addMaterial(s, { kind: 'image', path: notImg, label: '' })).rejects.toThrow(
      /not a PNG/
    )
    // A relative path is refused.
    await expect(addMaterial(s, { kind: 'image', path: 'rel.png', label: '' })).rejects.toThrow(
      /absolute/
    )
  })
})
