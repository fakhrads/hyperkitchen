// The materials library: reusable build ingredients (GApps zips, reference ROMs, images)
// registered once by path and reused across projects. Files stay where they are on disk;
// HyperKitchen never copies them into the repo. Stored in settings (per machine).

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { Material } from '../shared/types'
import { hashFile } from '../worker/fsutil'
import { readManifest } from '../worker/formats/axml'
import { imageInfo } from '../worker/formats/image'
import { readSigner } from '../worker/formats/apksig'
import { ZipFile } from '../worker/formats/zip'
import { inspectGappsZip } from '../worker/recipe/gapps'
import type { SettingsStore } from './settings'

const AddSchema = z.object({
  kind: z.enum(['gapps', 'reference-rom', 'image']),
  path: z.string().min(1).refine(isAbsolute, 'must be an absolute path'),
  label: z.string().max(80).default('')
})

const signal = (): AbortSignal => new AbortController().signal

/** Validate a candidate file/folder and build its Material record (not yet stored). */
async function describe(kind: Material['kind'], path: string, label: string): Promise<Material> {
  if (!existsSync(path)) throw new Error(`${path}: no such file or folder`)
  const base: Omit<Material, 'meta' | 'sha256'> = {
    id: randomUUID(),
    kind,
    path,
    label: label.trim(),
    addedAt: new Date().toISOString()
  }
  if (kind === 'gapps') {
    const info = await inspectGappsZip(path)
    return {
      ...base,
      label: base.label || `MindTheGapps ${info.version ?? '?'} ${info.arch ?? ''}`.trim(),
      sha256: info.sha256,
      meta: {
        version: info.version ?? '',
        arch: info.arch ?? '',
        apps: String(info.units.length)
      }
    }
  }
  if (kind === 'image') {
    const data = await readFile(path)
    const info = imageInfo(data)
    if (!info) throw new Error(`${path}: not a PNG, JPEG or WebP image`)
    return {
      ...base,
      label: base.label || path.split('/').pop() || 'image',
      sha256: await hashFile(path, signal()),
      meta: { type: info.type, size: `${info.width}x${info.height}` }
    }
  }
  if (kind === 'app') {
    const z = await ZipFile.open(path)
    try {
      const m = await z.read('AndroidManifest.xml')
      const info = m ? readManifest(m) : null
      if (!info?.packageName) throw new Error(`${path}: not a valid APK`)
      const signer = await readSigner(z).catch(() => ({ certSha256: null }))
      return {
        ...base,
        label: base.label || `${info.packageName} ${info.versionName ?? ''}`.trim(),
        sha256: await hashFile(path, signal()),
        meta: {
          package: info.packageName,
          version: info.versionName ?? '',
          sharedUserId: info.sharedUserId ?? '',
          signer: signer.certSha256 ? signer.certSha256.slice(0, 12) : ''
        }
      }
    } finally {
      await z.close()
    }
  }
  // reference-rom: an unpacked HyperKitchen project folder.
  const stockFile = join(path, 'stock', 'stock.json')
  if (!existsSync(stockFile))
    throw new Error(`${path}: not an unpacked project (no stock/stock.json)`)
  const stock = JSON.parse(await readFile(stockFile, 'utf8')) as {
    device: string | null
    romVersion: string | null
  }
  return {
    ...base,
    label: base.label || `${stock.device ?? '?'} ${stock.romVersion ?? ''}`.trim(),
    meta: { device: stock.device ?? '', romVersion: stock.romVersion ?? '' }
  }
}

export async function listMaterials(settings: SettingsStore): Promise<Material[]> {
  return (await settings.get()).materials
}

export async function addMaterial(settings: SettingsStore, raw: unknown): Promise<Material> {
  const { kind, path, label } = AddSchema.parse(raw)
  const material = await describe(kind, path, label)
  const current = (await settings.get()).materials
  // Replace a material that points at the same path and kind rather than duplicate it.
  const materials = [...current.filter((m) => !(m.kind === kind && m.path === path)), material]
  await settings.update({ materials })
  return material
}

export async function removeMaterial(settings: SettingsStore, id: string): Promise<void> {
  const current = (await settings.get()).materials
  await settings.update({ materials: current.filter((m) => m.id !== z.string().parse(id)) })
}
