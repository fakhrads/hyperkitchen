// Branding media: boot animation and default wallpapers (M9).
//
// Boot animation: the format is AOSP cmds/bootanimation/FORMAT.md; BootAnimation.cpp refuses
// a zip with any compressed entry ("bootanimation.zip is compressed; must be only stored").
// On onyx the loader (libbootanimation + Xiaomi's libcustbootanimationimpl) reads a theme the
// user applied (/data/system/theme/boots), operator folders (/product/opcust, China Mobile
// variant only), then /product/media/bootanimation.zip, which is the file replaced here.
//
// Wallpapers: Xiaomi's wallpaper app (product/app/WallpaperOS3) loads
// /system/media/wallpaper/wallpaper_%s.jpg, %s being the device colour code; /system/media is a
// link to /product/media. Every colour variant present is replaced. On onyx those .jpg files
// hold PNG data (1280x2772), so the decoder goes by content: PNG or JPEG is accepted. The
// default lock screen image is product/media/theme/default/lock_wallpaper, a PNG in stock;
// only PNG is accepted there.

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import type { Operation, OperationReport } from '../../shared/recipe'
import { imageInfo, type ImageInfo } from '../formats/image'
import { ZipFile } from '../formats/zip'
import { storedZip } from '../formats/zipwrite'
import type { OpContext } from './ops'

export const BOOTANIMATION = 'product/media/bootanimation.zip'
export const LOCK_WALLPAPER = 'product/media/theme/default/lock_wallpaper'
const WALLPAPER_DIR = 'product/media/wallpaper'

export interface DescPart {
  type: string
  count: number
  pause: number
  path: string
  background: string | null
}

export interface Desc {
  width: number
  height: number
  fps: number
  parts: DescPart[]
}

/** desc.txt: `W H FPS [PROGRESS]`, an optional dynamic_colors line, then part lines. */
export function parseDesc(text: string): { desc: Desc | null; problems: string[] } {
  const problems: string[] = []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const head = lines[0]?.split(/\s+/) ?? []
  const [width, height, fps] = head.map(Number)
  if (head.length < 3 || ![width, height, fps].every((n) => Number.isInteger(n) && n > 0)) {
    return { desc: null, problems: ['desc.txt: the first line must be "WIDTH HEIGHT FPS"'] }
  }
  const parts: DescPart[] = []
  for (const l of lines.slice(1)) {
    const f = l.split(/\s+/)
    if (f[0] === 'dynamic_colors') continue
    if (f[0] === '$SYSTEM') {
      parts.push({ type: '$SYSTEM', count: 0, pause: 0, path: '', background: null })
      continue
    }
    if (!['p', 'c', 'f'].includes(f[0]) || f.length < 4) {
      problems.push(`desc.txt: unrecognised line "${l}"`)
      continue
    }
    const count = Number(f[1])
    const pause = Number(f[2])
    if (!Number.isInteger(count) || !Number.isInteger(pause) || count < 0 || pause < 0) {
      problems.push(`desc.txt: COUNT and PAUSE must be whole numbers in "${l}"`)
      continue
    }
    // f has FADE before the colour; p and c have the colour right after PATH.
    const colour = (f[0] === 'f' ? f[5] : f[4]) ?? null
    if (colour !== null && !/^#[0-9a-fA-F]{6}$/.test(colour)) {
      problems.push(`desc.txt: background "${colour}" is not #RRGGBB in "${l}"`)
    }
    parts.push({ type: f[0], count, pause, path: f[3], background: colour })
  }
  if (!parts.length) problems.push('desc.txt: no parts')
  return { desc: { width, height, fps, parts }, problems }
}

export interface BootanimationReport {
  desc: Desc | null
  frames: number
  compressedEntries: number
  /** Problems that make the animation fail or look wrong; the build refuses the zip. */
  problems: string[]
  warnings: string[]
}

const isFrame = (n: string): boolean => !/\/(trim\.txt|audio\.wav)$/.test(n) && !n.endsWith('/')

/** Check a bootanimation.zip against the AOSP format. */
export async function inspectBootanimation(
  path: string,
  screen?: { width: number; height: number }
): Promise<BootanimationReport> {
  const z = await ZipFile.open(path)
  try {
    const problems: string[] = []
    const warnings: string[] = []
    const descBuf = await z.read('desc.txt')
    if (!descBuf)
      return { desc: null, frames: 0, compressedEntries: 0, problems: ['no desc.txt'], warnings }
    const { desc, problems: dp } = parseDesc(descBuf.toString('utf8'))
    problems.push(...dp)
    const compressedEntries = [...z.entries.values()].filter((e) => e.method !== 0).length
    let frames = 0
    if (desc) {
      for (const part of desc.parts.filter((p) => p.type !== '$SYSTEM')) {
        const names = [...z.entries.keys()].filter(
          (n) => n.startsWith(`${part.path}/`) && isFrame(n)
        )
        if (!names.length) {
          problems.push(`part ${part.path}: no frames`)
          continue
        }
        const hasTrim = z.entries.has(`${part.path}/trim.txt`)
        for (const n of names) {
          const info = imageInfo((await z.read(n, 64 * 1024 * 1024)) as Buffer)
          if (!info) {
            problems.push(`${n}: not a PNG, JPEG or WebP image`)
            continue
          }
          if (!hasTrim && (info.width !== desc.width || info.height !== desc.height)) {
            problems.push(
              `${n}: ${info.width}x${info.height}, desc.txt says ${desc.width}x${desc.height}`
            )
          }
          if (info.type !== 'png')
            warnings.push(`${n}: ${info.type}; FORMAT.md documents PNG frames`)
          frames++
        }
      }
      if (screen && (desc.width !== screen.width || desc.height !== screen.height)) {
        warnings.push(
          `the animation is ${desc.width}x${desc.height}, the stock one ${screen.width}x${screen.height}; it is drawn centred, not scaled`
        )
      }
    }
    if (compressedEntries) {
      warnings.push(
        `${compressedEntries} compressed entries; HyperKitchen stores them uncompressed`
      )
    }
    return {
      desc,
      frames,
      compressedEntries,
      problems,
      warnings: [...new Set(warnings)].slice(0, 20)
    }
  } finally {
    await z.close()
  }
}

/** The same zip with every entry stored, in the original order (frame order matters). */
export async function restoreStored(path: string): Promise<Buffer> {
  const z = await ZipFile.open(path)
  try {
    const out: Array<{ name: string; data: Buffer }> = []
    for (const name of z.entries.keys()) {
      if (name.endsWith('/')) continue
      out.push({ name, data: (await z.read(name, 256 * 1024 * 1024)) as Buffer })
    }
    return storedZip(out)
  } finally {
    await z.close()
  }
}

/**
 * A boot animation from one image: shown centred on `background` until boot completes
 * (`p 0 0 part0`: COUNT 0 loops until the system is up).
 */
export function staticBootanimation(img: Buffer, background: string): Buffer {
  const info = imageInfo(img)
  if (!info) throw new Error('the logo must be a PNG, JPEG or WebP image')
  if (!/^#[0-9a-fA-F]{6}$/.test(background)) throw new Error('background must be #RRGGBB')
  const ext = info.type === 'jpeg' ? 'jpg' : info.type
  return storedZip([
    {
      name: 'desc.txt',
      data: Buffer.from(`${info.width} ${info.height} 1\np 0 0 part0 ${background.toLowerCase()}\n`)
    },
    { name: `part0/00000.${ext}`, data: img }
  ])
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

async function source(file: string, sha256: string): Promise<Buffer> {
  const b = await readFile(file)
  if (sha(b) !== sha256) throw new Error(`${file} changed since it was added (sha256 differs)`)
  return b
}

function needImage(
  b: Buffer,
  file: string,
  types: Array<ImageInfo['type']>,
  like: ImageInfo | null,
  warn: (s: string) => void
): ImageInfo {
  const info = imageInfo(b)
  if (!info || !types.includes(info.type))
    throw new Error(`${file}: must be ${types.map((t) => t.toUpperCase()).join(' or ')}`)
  if (like && (info.width !== like.width || info.height !== like.height)) {
    warn(`${file} is ${info.width}x${info.height}; the stock image is ${like.width}x${like.height}`)
  }
  return info
}

export async function applyMedia(
  ctx: OpContext,
  op: Extract<Operation, { type: 'media' }>,
  r: OperationReport
): Promise<void> {
  const { bootanimation, wallpaper, lockWallpaper } = op.params
  if (bootanimation) {
    if (!ctx.tree.exists(BOOTANIMATION)) throw new Error(`${BOOTANIMATION} is not in this ROM`)
    const raw = await source(bootanimation.file, bootanimation.sha256)
    let data: Buffer
    if (bootanimation.kind === 'image') {
      data = staticBootanimation(raw, bootanimation.background)
    } else {
      const rep = await inspectBootanimation(bootanimation.file)
      if (rep.problems.length)
        throw new Error(`boot animation: ${rep.problems.slice(0, 5).join('; ')}`)
      r.warnings.push(...rep.warnings)
      data = rep.compressedEntries ? await restoreStored(bootanimation.file) : raw
    }
    await ctx.tree.writeExisting(BOOTANIMATION, data)
    r.modified.push(BOOTANIMATION)
  }
  if (wallpaper) {
    const raw = await source(wallpaper.file, wallpaper.sha256)
    if (!ctx.tree.exists(WALLPAPER_DIR)) throw new Error(`${WALLPAPER_DIR} is not in this ROM`)
    const variants = (await readdir(ctx.tree.abs(WALLPAPER_DIR))).filter((n) =>
      /^wallpaper_[A-Za-z0-9]+\.jpg$/.test(n)
    )
    if (!variants.length) throw new Error(`no ${WALLPAPER_DIR}/wallpaper_*.jpg in this ROM`)
    const stock = imageInfo(await ctx.tree.read(posix.join(WALLPAPER_DIR, variants[0])))
    needImage(raw, wallpaper.file, ['png', 'jpeg'], stock, (w) => r.warnings.push(w))
    for (const n of variants) {
      const p = posix.join(WALLPAPER_DIR, n)
      await ctx.tree.writeExisting(p, raw)
      r.modified.push(p)
    }
  }
  if (lockWallpaper) {
    if (!ctx.tree.exists(LOCK_WALLPAPER)) throw new Error(`${LOCK_WALLPAPER} is not in this ROM`)
    const raw = await source(lockWallpaper.file, lockWallpaper.sha256)
    const stock = imageInfo(await ctx.tree.read(LOCK_WALLPAPER))
    needImage(raw, lockWallpaper.file, ['png'], stock, (w) => r.warnings.push(w))
    await ctx.tree.writeExisting(LOCK_WALLPAPER, raw)
    r.modified.push(LOCK_WALLPAPER)
  }
}

export interface MediaFileInfo {
  path: string
  sha256: string
  size: number
  image: ImageInfo | null
  bootanimation: BootanimationReport | null
}

/** What a chosen file is, for the recipe editor (screen size from the stock animation). */
export async function inspectMediaFile(path: string, stockFs?: string): Promise<MediaFileInfo> {
  const b = await readFile(path)
  let screen: { width: number; height: number } | undefined
  if (stockFs) {
    try {
      const z = await ZipFile.open(posix.join(stockFs, BOOTANIMATION))
      const d = await z.read('desc.txt')
      await z.close()
      const parsed = d ? parseDesc(d.toString('utf8')).desc : null
      if (parsed) screen = { width: parsed.width, height: parsed.height }
    } catch {
      screen = undefined
    }
  }
  return {
    path,
    sha256: sha(b),
    size: b.length,
    image: imageInfo(b),
    bootanimation: path.endsWith('.zip') ? await inspectBootanimation(path, screen) : null
  }
}
