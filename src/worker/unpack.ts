// M2 unpack job: turn a stock ROM (fastboot tgz, images zip, OTA zip, payload.bin, folder or a
// single image) into <project>/stock/:
//
//   stock/images/<part>.img     raw partition images (super split into its logical partitions)
//   stock/fs/<part>/            extracted trees (erofs), stock/fs/config/<part>_fs_config etc.
//   stock/firmware/             firmware images and flash scripts kept for the flashable output
//   stock/stock.json            StockInfo: input, super layout, partitions, build.prop files
//   stock/inventory.json        Inventory: every APK with package, version and signer
//
// The input itself is never modified. Archive inputs are extracted into <project>/source/ and
// that extraction is removed once everything has been moved into stock/.

import { createHash } from 'node:crypto'
import { constants as fsc, createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { assertInside } from '../main/safety'
import type {
  ImageKind,
  InputKind,
  Inventory,
  PartitionInfo,
  ProjectMeta,
  PropFile,
  StockInfo,
  SuperLayout
} from '../shared/types'
import { throwIfCancelled, type JobContext } from './context'
import { detectSourceKind } from './formats/fstype'
import {
  LP_HEADER_FLAG_VIRTUAL_AB_DEVICE,
  LP_SECTOR_SIZE,
  LP_TARGET_TYPE_LINEAR,
  readLpMetadata,
  type LpMetadata
} from './formats/lp'
import { RawFileSource, writeImage, type BlockSource } from './formats/source'
import { isSparseFile, SparseSource } from './formats/sparse'
import { inventoryApks, readPartitionProps } from './inventory'
import { run } from './spawn'

export interface UnpackParams {
  projectPath: string
  input: string
  /** Remove an earlier unpack (stock/ and source/) first. */
  reset: boolean
}

/** Progress over weighted stages: stage(i) maps 0..1 within stage i onto the whole job. */
class Stages {
  private readonly starts: number[] = []
  constructor(
    private readonly ctx: JobContext,
    private readonly weights: number[]
  ) {
    const total = weights.reduce((a, b) => a + b, 0)
    let acc = 0
    for (const w of weights) {
      this.starts.push(acc / total)
      acc += w
    }
    this.weights = weights.map((w) => w / total)
  }
  report(stage: number, frac: number, step: string): void {
    const f = Math.max(0, Math.min(1, frac))
    this.ctx.progress(this.starts[stage] + this.weights[stage] * f, step)
  }
}

const GiB = 1024 ** 3
const fmt = (n: number): string => `${(n / GiB).toFixed(2)} GiB`

/** Hash a file in the background. The promise never rejects unobserved: await it later. */
function hashInBackground(path: string, signal: AbortSignal): Promise<string> {
  const p = hashFile(path, signal)
  p.catch(() => {})
  return p
}

async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    throwIfCancelled(signal)
    h.update(chunk as Buffer)
  }
  return h.digest('hex')
}

/** Clone when the filesystem can (APFS via cp -c, btrfs/xfs via FICLONE), else copy. */
async function cloneOrCopy(src: string, dst: string): Promise<void> {
  if (process.platform === 'darwin') {
    // cp -c uses clonefile(2) and falls back to a normal copy across volumes (man cp).
    const r = await run('cp', ['-c', src, dst])
    if (r.code !== 0) throw new Error(`cp -c ${src}: ${r.output.trim()}`)
  } else {
    await copyFile(src, dst, fsc.COPYFILE_FICLONE)
  }
}

/** Total uncompressed size from the last line of `unzip -l` ("<bytes>  <n> files"). */
async function zipUncompressedSize(zip: string): Promise<number> {
  const r = await run('unzip', ['-l', zip], { maxCapture: 4 * 1024 * 1024 })
  const last = r.output.trim().split('\n').pop() ?? ''
  const m = last.match(/^\s*(\d+)\s+\d+\s+files?\s*$/)
  return m ? Number(m[1]) : 0
}

/** Apparent size of all regular files under dir. */
async function dirSize(dir: string): Promise<number> {
  let n = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop() as string
    let ents
    try {
      ents = await readdir(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile())
        n += await stat(p).then(
          (s) => s.size,
          () => 0
        )
    }
  }
  return n
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0
  } catch {
    return true
  }
}

export async function detectInput(input: string): Promise<InputKind> {
  const st = await stat(input)
  if (st.isDirectory()) return 'folder'
  const name = basename(input).toLowerCase()
  if (name.endsWith('.tgz') || name.endsWith('.tar.gz') || name.endsWith('.tar')) {
    return 'fastboot-tgz'
  }
  if (name === 'payload.bin') return 'payload'
  if (name.endsWith('.zip')) {
    // unzip -Z1: zipinfo mode, file names only (man unzip, zipinfo usage). Handles zip64.
    const r = await run('unzip', ['-Z1', input], { maxCapture: 4 * 1024 * 1024 })
    if (r.code !== 0) throw new Error(`cannot list ${input}: ${r.output.slice(0, 300)}`)
    const names = r.output.split('\n').map((l) => l.trim())
    if (names.includes('payload.bin')) return 'ota-zip'
    if (names.some((n) => /^images\/super\.img(\.\d+)?$/.test(n))) return 'images-zip'
    throw new Error('zip has neither payload.bin nor images/super.img')
  }
  if (extname(name) === '.img') return 'image'
  throw new Error(`unrecognised input: ${input}`)
}

/** Directory that holds images/ (or the images themselves) inside an extracted archive. */
async function findRomRoot(dir: string): Promise<string> {
  const queue = [dir]
  for (let depth = 0; depth < 3 && queue.length; depth++) {
    for (const d of queue.splice(0)) {
      if (existsSync(join(d, 'images'))) return d
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) queue.push(join(d, e.name))
      }
    }
  }
  return dir
}

/** super.img, or a split set super.img.0 .. super.img.N in numeric order. */
async function findSuper(imagesDir: string): Promise<string[]> {
  const names = await readdir(imagesDir)
  if (names.includes('super.img')) return [join(imagesDir, 'super.img')]
  return names
    .map((n) => ({ n, m: n.match(/^super\.img\.(\d+)$/) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m![1]) - Number(b.m![1]))
    .map((x) => join(imagesDir, x.n))
}

async function openImage(paths: string[]): Promise<BlockSource> {
  if (await isSparseFile(paths[0])) return SparseSource.open(paths)
  if (paths.length > 1) throw new Error('split images must be sparse')
  return RawFileSource.open(paths[0])
}

/** Drop the slot suffix when the other slot is empty, so trees mount as /system, not /system_a. */
export function partitionFileNames(meta: LpMetadata): Map<string, string> {
  const used = meta.partitions.filter((p) => p.size > 0)
  const names = new Set(used.map((p) => p.name))
  const out = new Map<string, string>()
  for (const p of used) {
    const m = p.name.match(/^(.*)_([ab])$/)
    const other = m ? `${m[1]}_${m[2] === 'a' ? 'b' : 'a'}` : null
    out.set(p.name, m && other && !names.has(other) ? m[1] : p.name)
  }
  return out
}

function superLayout(meta: LpMetadata): SuperLayout {
  return {
    metadataMaxSize: meta.geometry.metadataMaxSize,
    metadataSlotCount: meta.geometry.metadataSlotCount,
    logicalBlockSize: meta.geometry.logicalBlockSize,
    version: `${meta.major}.${meta.minor}`,
    virtualAb: (meta.headerFlags & LP_HEADER_FLAG_VIRTUAL_AB_DEVICE) !== 0,
    blockDevices: meta.blockDevices.map((b) => ({
      name: b.partitionName,
      size: b.size,
      alignment: b.alignment,
      firstLogicalSector: b.firstLogicalSector
    })),
    groups: meta.groups.map((g) => ({ name: g.name, maximumSize: g.maximumSize })),
    partitions: meta.partitions.map((p) => ({
      name: p.name,
      group: p.groupName,
      attributes: p.attributes,
      size: p.size
    }))
  }
}

function firstProp(props: PropFile[], keys: string[]): string | null {
  for (const k of keys) for (const f of props) if (f.props[k]) return f.props[k]
  return null
}

export interface UnpackSummary {
  device: string | null
  romVersion: string | null
  partitions: number
  extracted: number
  apks: number
}

export async function unpack(ctx: JobContext, params: UnpackParams): Promise<UnpackSummary> {
  const project = resolve(params.projectPath)
  const metaPath = join(project, 'project.json')
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as ProjectMeta
  const input = resolve(params.input)
  const inside = (p: string): string => assertInside(project, p)
  const sourceDir = inside(join(project, 'source'))
  const stockDir = inside(join(project, 'stock'))
  const imagesOut = inside(join(stockDir, 'images'))
  const fsOut = inside(join(stockDir, 'fs'))
  const firmwareOut = inside(join(stockDir, 'firmware'))
  if (resolve(input).startsWith(project + '/'))
    throw new Error('the input must be outside the project')

  if (!(await isEmptyDir(stockDir)) || !(await isEmptyDir(sourceDir))) {
    if (!params.reset)
      throw new Error('this project is already unpacked; choose re-unpack to replace it')
    ctx.log('removing the previous unpack (stock/ and source/)')
    await rm(stockDir, { recursive: true, force: true })
    await rm(sourceDir, { recursive: true, force: true })
  }
  for (const d of [sourceDir, stockDir, imagesOut, fsOut, firmwareOut])
    await mkdir(d, { recursive: true })

  const kind = await detectInput(input)
  ctx.log(`input: ${input} (${kind})`)
  // 0 input, 1 firmware, 2 super, 3 erofs, 4 inventory
  const stages = new Stages(ctx, [20, 2, 30, 38, 10])
  let sha256: string | null = null
  let romRoot: string | null = null
  let extractedArchive = false

  // ---- stage 0: get the images out of the input
  if (kind === 'fastboot-tgz') {
    const total = (await stat(input)).size
    const h = createHash('sha256')
    let seen = 0
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        h.update(chunk)
        seen += chunk.length
        stages.report(0, seen / total, `extracting archive ${fmt(seen)} / ${fmt(total)}`)
        cb(null, chunk)
      }
    })
    const stream = createReadStream(input, { highWaterMark: 4 * 1024 * 1024 })
    let readError: Error | null = null
    // pipe() does not forward errors; without this tar would wait for more input forever.
    stream.on('error', (e) => {
      readError = e
      tap.destroy(e)
    })
    stream.pipe(tap)
    const gz = input.toLowerCase().endsWith('.tar') ? [] : ['-z']
    try {
      // bsdtar and GNU tar: -x extract, -z gzip, -f - read the archive from stdin, -C target dir.
      const r = await run('tar', ['-x', ...gz, '-f', '-', '-C', sourceDir], {
        stdin: tap,
        signal: ctx.signal,
        onLine: (l, s) => ctx.log(l, s)
      })
      if (readError) throw new Error(`cannot read ${input}: ${(readError as Error).message}`)
      if (r.code !== 0) throw new Error(`tar failed (exit ${r.code})`)
    } finally {
      stream.destroy()
    }
    sha256 = h.digest('hex')
    romRoot = await findRomRoot(sourceDir)
    extractedArchive = true
  } else if (kind === 'images-zip') {
    stages.report(0, 0, 'extracting zip')
    const hashing = hashInBackground(input, ctx.signal)
    // unzip prints no progress; compare the bytes on disk with the listed total.
    const total = await zipUncompressedSize(input)
    const timer = setInterval(() => {
      void dirSize(sourceDir).then((n) =>
        stages.report(0, total ? n / total : 0, `extracting zip ${fmt(n)} / ${fmt(total)}`)
      )
    }, 1000)
    // -q quiet, -o overwrite without prompting, -d target dir (man unzip).
    const r = await run('unzip', ['-q', '-o', input, '-d', sourceDir], {
      signal: ctx.signal,
      onLine: (l, s) => ctx.log(l, s)
    }).finally(() => clearInterval(timer))
    if (r.code !== 0) throw new Error(`unzip failed (exit ${r.code})`)
    sha256 = await hashing
    romRoot = await findRomRoot(sourceDir)
    extractedArchive = true
  } else if (kind === 'ota-zip' || kind === 'payload') {
    stages.report(0, 0, 'dumping payload')
    const hashing = hashInBackground(input, ctx.signal)
    const bin = join(ctx.env.binDir ?? '', 'payload-dumper-go')
    // -o output dir; the input may be payload.bin or the OTA zip itself (payload-dumper-go README).
    const r = await run(bin, ['-o', imagesOut, input], {
      signal: ctx.signal,
      onLine: (l, s) => ctx.log(l, s)
    })
    if (r.code !== 0) throw new Error(`payload-dumper-go failed (exit ${r.code})`)
    sha256 = await hashing
  } else if (kind === 'folder') {
    romRoot = await findRomRoot(input)
  }
  stages.report(0, 1, 'input ready')

  // ---- stage 1: keep firmware and flash scripts for the flashable output
  const firmware: string[] = []
  let superFiles: string[] = []
  if (romRoot) {
    const imagesDir = existsSync(join(romRoot, 'images')) ? join(romRoot, 'images') : romRoot
    superFiles = await findSuper(imagesDir)
    const superSet = new Set(superFiles)
    await mkdir(join(firmwareOut, 'images'), { recursive: true })
    const moves: Array<[string, string]> = []
    for (const e of await readdir(imagesDir, { withFileTypes: true })) {
      const p = join(imagesDir, e.name)
      if (e.isFile() && !superSet.has(p)) moves.push([p, join(firmwareOut, 'images', e.name)])
    }
    if (imagesDir !== romRoot) {
      for (const e of await readdir(romRoot, { withFileTypes: true })) {
        if (e.isFile() && /\.(sh|bat|txt)$/i.test(e.name)) {
          moves.push([join(romRoot, e.name), join(firmwareOut, e.name)])
        }
      }
    }
    for (const [i, [from, to]] of moves.entries()) {
      throwIfCancelled(ctx.signal)
      // Our own extraction can be moved; a user folder is cloned or copied, never touched.
      if (extractedArchive) await rename(from, inside(to))
      else await cloneOrCopy(from, inside(to))
      firmware.push(to.slice(firmwareOut.length + 1))
      stages.report(1, (i + 1) / moves.length, `firmware ${i + 1}/${moves.length}`)
    }
  } else if (kind === 'image') {
    superFiles = [input]
  }

  // ---- stage 2: split super into partition images
  let layout: SuperLayout | null = null
  const lpNames = new Map<string, string>()
  if (superFiles.length) {
    const src = await openImage(superFiles)
    try {
      const k = await detectSourceKind(src)
      if (k !== 'super') {
        if (kind !== 'image') throw new Error(`${superFiles[0]} is not a super image (${k})`)
        // A single partition image: copy it as is.
        const name = basename(input).replace(/\.img$/i, '')
        await writeImage(src, inside(join(imagesOut, `${name}.img`)), src.size, [
          { srcPos: 0, outPos: 0, len: src.size }
        ])
      } else {
        const lp = await readLpMetadata(src)
        layout = superLayout(lp)
        ctx.log(
          `super: ${lp.partitions.filter((p) => p.size > 0).length} partitions, metadata v${layout.version}, ` +
            `virtual A/B ${layout.virtualAb ? 'yes' : 'no'}`
        )
        const fileNames = partitionFileNames(lp)
        const total = lp.partitions.reduce((s, p) => s + p.size, 0)
        let done = 0
        for (const p of lp.partitions.filter((x) => x.size > 0)) {
          const name = fileNames.get(p.name) as string
          lpNames.set(name, p.name)
          let pos = 0
          const ranges: Array<{ srcPos: number; outPos: number; len: number }> = []
          for (const e of p.extents) {
            const len = e.numSectors * LP_SECTOR_SIZE
            if (e.targetType === LP_TARGET_TYPE_LINEAR) {
              if (e.targetSource !== 0)
                throw new Error(`${p.name}: multi-device super is not supported`)
              if (e.targetData * LP_SECTOR_SIZE + len > src.size) {
                throw new Error(
                  `${p.name}: extent ends past the end of the super image (incomplete split set?)`
                )
              }
              ranges.push({ srcPos: e.targetData * LP_SECTOR_SIZE, outPos: pos, len })
            }
            pos += len
          }
          ctx.log(`writing ${name}.img (${fmt(p.size)})`)
          await writeImage(
            src,
            inside(join(imagesOut, `${name}.img`)),
            p.size,
            ranges,
            (n) => {
              done += n
              stages.report(2, done / total, `super: ${name}`)
            },
            ctx.signal
          )
        }
      }
    } finally {
      await src.close()
    }
  }
  if (extractedArchive) {
    // Everything we need has been moved or split out; drop the rest of the extraction.
    await rm(sourceDir, { recursive: true, force: true })
    await mkdir(sourceDir)
  }

  // ---- stage 3: extract erofs partitions
  const partitions: PartitionInfo[] = []
  const imageFiles = (await readdir(imagesOut)).filter((n) => n.endsWith('.img')).sort()
  const sizes = new Map<string, number>()
  for (const n of imageFiles) sizes.set(n, (await stat(join(imagesOut, n))).size)
  const totalImg = [...sizes.values()].reduce((a, b) => a + b, 0) || 1
  let doneImg = 0
  for (const n of imageFiles) {
    throwIfCancelled(ctx.signal)
    const name = n.replace(/\.img$/, '')
    const path = join(imagesOut, n)
    const src = await RawFileSource.open(path)
    let k: ImageKind
    try {
      k = await detectSourceKind(src)
    } finally {
      await src.close()
    }
    const info: PartitionInfo = {
      name,
      lpName: lpNames.get(name) ?? null,
      size: sizes.get(n) ?? 0,
      kind: k,
      extracted: false,
      note: null
    }
    if (k === 'erofs') {
      stages.report(3, doneImg / totalImg, `extracting ${name}`)
      const bin = join(ctx.env.binDir ?? '', 'extract.erofs')
      // -i image, -x extract all (also writes config/<name>_fs_config, _file_contexts,
      // _fs_options), -o output dir, -s no progress spam (extract.erofs --help).
      const r = await run(bin, ['-i', path, '-x', '-s', '-o', fsOut], {
        signal: ctx.signal,
        onLine: (l, s) => ctx.log(l, s)
      })
      if (r.code !== 0) throw new Error(`extract.erofs ${name} failed (exit ${r.code})`)
      if (!existsSync(join(fsOut, name))) throw new Error(`extract.erofs did not create fs/${name}`)
      info.extracted = true
    } else if (k === 'ext4') {
      info.note = 'ext4 extraction is not implemented yet'
      ctx.log(`${name}: ext4, not extracted (not implemented yet)`)
    } else {
      info.note = `not a filesystem image (${k})`
    }
    partitions.push(info)
    doneImg += info.size
    stages.report(3, doneImg / totalImg, `extracted ${name}`)
  }

  // ---- stage 4: inventory
  stages.report(4, 0, 'reading build.prop')
  const trees = partitions
    .filter((p) => p.extracted)
    .map((p) => ({ name: p.name, root: join(fsOut, p.name) }))
  const props: PropFile[] = []
  for (const t of trees) props.push(...(await readPartitionProps(t.name, t.root)))
  const apks = await inventoryApks(trees, ctx.signal, (d, t) =>
    stages.report(4, d / t, `APK ${d}/${t}`)
  )
  const failed = apks.filter((a) => a.error)
  ctx.log(`inventory: ${apks.length} APKs, ${failed.length} unreadable`)
  for (const a of failed.slice(0, 20)) ctx.log(`  ${a.partition}/${a.path}: ${a.error}`, 'stderr')

  // misc.txt in Xiaomi fastboot packages names the device and build.
  let misc: Record<string, string> = {}
  try {
    const text = await readFile(join(firmwareOut, 'misc.txt'), 'utf8')
    misc = Object.fromEntries(
      text.split(/\r?\n/).flatMap((l) => {
        const i = l.indexOf('=')
        return i > 0 ? [[l.slice(0, i).trim(), l.slice(i + 1).trim()]] : []
      })
    )
  } catch {
    /* not a Xiaomi fastboot package */
  }
  // Xiaomi sets generic names in some partitions (vendor: mivendor, system: generic,
  // product: miproduct); misc.txt and the odm/dlkm partitions carry the real codename.
  const device =
    misc.device ??
    firstProp(props, [
      'ro.product.odm.device',
      'ro.product.vendor_dlkm.device',
      'ro.product.system_dlkm.device',
      'ro.product.vendor.device',
      'ro.product.device'
    ]) ??
    null
  const romVersion =
    firstProp(props, ['ro.mi.os.version.incremental', 'ro.build.version.incremental']) ??
    misc.build_number ??
    null

  const info: StockInfo = {
    schema: 1,
    unpackedAt: new Date().toISOString(),
    input: { path: input, kind, sha256 },
    device,
    romVersion,
    super: layout,
    partitions,
    props,
    firmware
  }
  const inventory: Inventory = { schema: 1, apks }
  await writeFile(inside(join(stockDir, 'stock.json')), JSON.stringify(info, null, 2))
  await writeFile(inside(join(stockDir, 'inventory.json')), JSON.stringify(inventory))
  const nextMeta: ProjectMeta = { ...meta, device, romVersion, source: { path: input, sha256 } }
  await writeFile(metaPath, JSON.stringify(nextMeta, null, 2))
  stages.report(4, 1, 'done')
  return {
    device,
    romVersion,
    partitions: partitions.length,
    extracted: trees.length,
    apks: apks.length
  }
}
