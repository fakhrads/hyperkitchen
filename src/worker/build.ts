// M3 build job: stock/ -> work/ -> build/<id>/, a fastboot package the user flashes manually.
//
//   1. work/fs is a fresh clone of stock/fs (the recipe will edit it from M4 on)
//   2. every extracted erofs partition is rebuilt with mkfs.erofs using the stock block size,
//      timestamp and UUID (read from the stock superblock) and the fs_config/file_contexts
//   3. optional gate: each new image is extracted again and compared file by file, and its
//      fs_config/file_contexts with the ones it was built from
//   4. lpmake builds super.img with the stock layout (geometry, groups, attributes, virtual A/B)
//   5. super.img is read back: layout must match stock, partition data must match the images
//   6. firmware is copied, verity is handled (see VerityMode), flash scripts are generated
//   7. checksums.sha256, build.json and build.log are written
//
// HyperKitchen never runs fastboot; the package's scripts are for the user.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { assertInside } from '../main/safety'
import { RecipeSchema } from '../shared/recipe'
import type { BuildInfo, Inventory, StockInfo, VerityMode } from '../shared/types'
import { detectJava, MIN_JAVA_MAJOR } from './java'
import { applyRecipe } from './recipe/apply'
import { CancelledError, throwIfCancelled, type JobContext } from './context'
import { readErofsSuper } from './formats/erofs'
import { LP_HEADER_FLAG_VIRTUAL_AB_DEVICE, LP_SECTOR_SIZE, readLpMetadata } from './formats/lp'
import { SparseSource } from './formats/sparse'
import {
  AVB_FLAG_HASHTREE_DISABLED,
  AVB_FLAG_VERIFICATION_DISABLED,
  vbmetaFlags,
  withVbmetaFlags
} from './formats/vbmeta'
import { cloneOrCopy, cloneTree, hashFile } from './fsutil'
import { parseStockScript } from './flashscript'
import { writePackage } from './package'
import { hasAvbFlags, stripAvbFlags } from './fstab'
import { run } from './spawn'
import { compareLineSets, compareTrees } from './treecompare'

export interface BuildParams {
  projectPath: string
  verity: VerityMode
  /** Extract every rebuilt image again and compare it file by file (slow, on by default). */
  verify: boolean
  /** Also write one zip with everything, like xiaomi.eu (also installable from recovery). */
  zip: boolean
  /** Shown in generated files, e.g. "HyperKitchen 0.1.0". */
  generator: string
}

const GiB = 1024 ** 3
const fmt = (n: number): string => `${(n / GiB).toFixed(2)} GiB`

class Stages {
  private readonly starts: number[] = []
  private readonly weights: number[]
  constructor(
    private readonly ctx: JobContext,
    weights: number[]
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
    this.ctx.progress(
      this.starts[stage] + this.weights[stage] * Math.max(0, Math.min(1, frac)),
      step
    )
  }
}

function buildId(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Magic bytes of ramdisk compressions magiskboot can write back (its `compress=` names). */
function ramdiskFormat(head: Buffer): string | null {
  if (head.subarray(0, 6).toString('latin1') === '070701') return null
  if (head.readUInt32LE(0) === 0x184c2102) return 'lz4_legacy'
  if (head.readUInt32LE(0) === 0x184d2204) return 'lz4'
  if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip'
  if (head.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))) return 'xz'
  throw new Error(`unknown ramdisk compression (magic ${head.subarray(0, 4).toString('hex')})`)
}

/** Octal mode from an `ls -l` style string, e.g. -rw-r--r-- -> 0644. */
function modeFromString(s: string): string {
  const bits = s.slice(1, 10)
  let v = 0
  for (let i = 0; i < 9; i++) if (bits[i] !== '-') v |= 1 << (8 - i)
  return '0' + v.toString(8).padStart(3, '0')
}

/**
 * Remove avb flags from every fstab in the vendor_boot ramdisk and repack it with magiskboot.
 * Returns a description of the changes. Throws when there is nothing to change.
 */
async function patchVendorBootFstab(
  magiskboot: string,
  image: string,
  tmp: string,
  log: (s: string) => void,
  signal: AbortSignal
): Promise<string[]> {
  const mb = async (cwd: string, args: string[]): Promise<string> => {
    const r = await run(magiskboot, args, { cwd, signal })
    if (r.code !== 0) throw new Error(`magiskboot ${args[0]} failed: ${r.output.slice(-300)}`)
    return r.output
  }
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  await cloneOrCopy(image, join(tmp, 'vendor_boot.img'))
  // magiskboot usage: unpack [-h] <bootimg> writes components to the cwd; -h dumps the header.
  await mb(tmp, ['unpack', '-h', 'vendor_boot.img'])
  const rdPath = join(tmp, 'ramdisk.cpio')
  if (!existsSync(rdPath)) throw new Error('vendor_boot has no ramdisk')
  const fmt0 = ramdiskFormat((await readFile(rdPath)).subarray(0, 8))
  const cpio = fmt0 ? 'rd.cpio' : 'ramdisk.cpio'
  if (fmt0) await mb(tmp, ['decompress', 'ramdisk.cpio', 'rd.cpio'])
  // cpio "ls -r": one entry per line, tab separated, mode string first and path last.
  const lsEntries = async (cwd: string, file: string): Promise<string[][]> =>
    (await mb(cwd, ['cpio', file, 'ls -r']))
      .split('\n')
      .map((l) => l.split('\t'))
      .filter((f) => f.length >= 2 && /^[-dlcbps]/.test(f[0]))
  const pathsOf = (entries: string[][]): string =>
    entries
      .map((f) => f[f.length - 1])
      .sort()
      .join('\n')
  const before = await lsEntries(tmp, cpio)
  const listing = before.filter((f) => f[0].startsWith('-'))
  const fstabs = listing.filter((f) => /(^|\/)fstab\.[^/]+$/.test(f[f.length - 1]))
  const changes: string[] = []
  for (const f of fstabs) {
    const entry = f[f.length - 1]
    const local = join(tmp, 'fstab.extracted')
    await mb(tmp, ['cpio', cpio, `extract ${entry} fstab.extracted`])
    const edit = stripAvbFlags(await readFile(local, 'utf8'))
    if (!edit.changed.length) continue
    await writeFile(join(tmp, 'fstab.patched'), edit.text)
    await mb(tmp, ['cpio', cpio, `add ${modeFromString(f[0])} ${entry} fstab.patched`])
    changes.push(`vendor_boot ${entry}: removed avb flags on ${edit.changed.length} lines`)
    log(`  ${entry}: avb flags removed on lines ${edit.changed.join(', ')}`)
  }
  if (!changes.length) {
    throw new Error('no fstab with avb flags in the vendor_boot ramdisk; use the vbmeta-flags mode')
  }
  if (fmt0) await mb(tmp, ['compress=' + fmt0, 'rd.cpio', 'ramdisk.cpio'])
  await mb(tmp, ['repack', 'vendor_boot.img', 'new-vendor_boot.img'])

  // Read the result back: same entries, no avb flags left.
  const check = join(tmp, 'check')
  await mkdir(check)
  await cloneOrCopy(join(tmp, 'new-vendor_boot.img'), join(check, 'vendor_boot.img'))
  await mb(check, ['unpack', 'vendor_boot.img'])
  const fmt1 = ramdiskFormat((await readFile(join(check, 'ramdisk.cpio'))).subarray(0, 8))
  if (fmt1 !== fmt0) throw new Error(`repacked ramdisk format ${fmt1} differs from ${fmt0}`)
  const cpio1 = fmt1 ? 'rd.cpio' : 'ramdisk.cpio'
  if (fmt1) await mb(check, ['decompress', 'ramdisk.cpio', 'rd.cpio'])
  if (pathsOf(await lsEntries(check, cpio1)) !== pathsOf(before)) {
    throw new Error('repacked vendor_boot ramdisk has a different set of entries')
  }
  for (const f of fstabs) {
    const entry = f[f.length - 1]
    await mb(check, ['cpio', cpio1, `extract ${entry} fstab.check`])
    if (hasAvbFlags(await readFile(join(check, 'fstab.check'), 'utf8'))) {
      throw new Error(`${entry} still has avb flags after repack`)
    }
  }
  await rename(join(tmp, 'new-vendor_boot.img'), image)
  return changes
}

export async function build(ctx: JobContext, params: BuildParams): Promise<BuildInfo> {
  const project = resolve(params.projectPath)
  const inside = (p: string): string => assertInside(project, p)
  const stockDir = join(project, 'stock')
  let stock: StockInfo
  try {
    stock = JSON.parse(await readFile(join(stockDir, 'stock.json'), 'utf8')) as StockInfo
  } catch {
    throw new Error('unpack a stock ROM first')
  }
  if (!stock.super) throw new Error('the stock ROM has no super partition layout')
  const recipe = RecipeSchema.parse(
    JSON.parse(await readFile(join(project, 'recipe.json'), 'utf8'))
  )
  const recipeOperations = recipe.operations.filter((o) => o.enabled).length
  const bin = (n: string): string => join(ctx.env.binDir ?? '', n)

  const id = buildId()
  const outDir = inside(join(project, 'build', id))
  const imagesOut = join(outDir, 'images')
  const tmp = join(outDir, '.tmp')
  const workDir = inside(join(project, 'work'))
  await mkdir(imagesOut, { recursive: true })
  await mkdir(tmp, { recursive: true })

  const logLines: string[] = []
  const log = (s: string, stream: 'info' | 'stdout' | 'stderr' = 'info'): void => {
    logLines.push(`[${new Date().toISOString()}] ${stream === 'info' ? '' : stream + ': '}${s}`)
    ctx.log(s, stream)
  }
  const info: BuildInfo = {
    schema: 1,
    id,
    status: 'failed',
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    device: stock.device,
    romVersion: stock.romVersion,
    stockInput: { path: stock.input.path, sha256: stock.input.sha256 },
    verity: params.verity,
    verityChanges: [],
    recipeOperations,
    operations: [],
    partitions: [],
    superVerified: false,
    scripts: [],
    warnings: []
  }
  // 0 work, 1 partitions (mkfs + verify), 2 recipe, 3 lpmake, 4 verify super,
  // 5 firmware + scripts, 6 checksums
  const stages = new Stages(ctx, [
    3,
    params.verify ? 60 : 30,
    recipeOperations ? 10 : 0,
    12,
    10,
    3,
    12
  ])

  try {
    log(
      `build ${id} for ${stock.device ?? '?'} ${stock.romVersion ?? ''}, verity mode ${params.verity}`
    )
    log(`recipe: ${recipeOperations} enabled operations`)

    // ---- 0: work/ from stock/
    stages.report(0, 0, 'preparing work/')
    await rm(workDir, { recursive: true, force: true })
    await mkdir(workDir)
    await cloneTree(join(stockDir, 'fs'), join(workDir, 'fs'), ctx.signal)
    stages.report(0, 1, 'work/ ready')

    // ---- 2: recipe
    if (recipeOperations) {
      const inventory = JSON.parse(
        await readFile(join(stockDir, 'inventory.json'), 'utf8')
      ) as Inventory
      const needsJava = recipe.operations.some((o) => o.enabled && o.type === 'patch')
      const java = needsJava ? await detectJava(ctx.env) : null
      if (needsJava && (!java || java.major < MIN_JAVA_MAJOR)) {
        throw new Error(`smali patches need Java ${MIN_JAVA_MAJOR}+ (install it from the Doctor)`)
      }
      info.operations = await applyRecipe(recipe, {
        workFs: join(workDir, 'fs'),
        partitions: stock.partitions.filter((p) => p.extracted).map((p) => p.name),
        apks: inventory.apks,
        java: java?.path ?? null,
        apktool: join(ctx.env.commonBinDir, 'apktool.jar'),
        tmp,
        signal: ctx.signal,
        log,
        progress: (f, step) => stages.report(2, f, step)
      })
      for (const r of info.operations) info.warnings.push(...r.warnings.map((w) => `${r.id}: ${w}`))
    }

    // ---- 1 + 2: rebuild and verify partitions
    const layout = stock.super
    const inSuper = stock.partitions.filter((p) => p.lpName)
    const totalSize = inSuper.reduce((s, p) => s + p.size, 0) || 1
    let doneSize = 0
    // Within a partition: mkfs is the first 40% when verifying, the comparison the rest.
    const mkfsShare = params.verify ? 0.4 : 1
    const partProgress = (p: { size: number }, frac: number, step: string): void =>
      stages.report(1, (doneSize + p.size * frac) / totalSize, step)
    const builtImage = new Map<string, string>()
    for (const p of inSuper) {
      throwIfCancelled(ctx.signal)
      const stockImg = join(stockDir, 'images', `${p.name}.img`)
      const out = join(tmp, `${p.name}.img`)
      let rebuilt = false
      let treeVerified = false
      if (p.kind === 'erofs' && p.extracted) {
        const sb = await readErofsSuper(stockImg)
        const cfg = join(workDir, 'fs', 'config')
        // mkfs.erofs [OPTIONS] FILE SOURCE (mkfs.erofs --help). -b is required: the default is
        // the host page size, 16 KiB on Apple Silicon, which Android kernels cannot mount.
        const args = [
          '-zlz4hc',
          `-b${sb.blockSize}`,
          `-T${sb.epoch}`,
          `-U${sb.uuid}`,
          ...(sb.volumeName ? ['-L', sb.volumeName] : []),
          `--mount-point=/${p.name}`,
          `--fs-config-file=${join(cfg, `${p.name}_fs_config`)}`,
          `--file-contexts=${join(cfg, `${p.name}_file_contexts`)}`,
          out,
          join(workDir, 'fs', p.name)
        ]
        partProgress(p, 0, `mkfs.erofs ${p.name}`)
        log(`mkfs.erofs ${args.join(' ')}`)
        const r = await run(bin('mkfs.erofs'), args, {
          signal: ctx.signal,
          onLine: (l, s) => log(l, s)
        })
        if (r.code !== 0) throw new Error(`mkfs.erofs ${p.name} failed (exit ${r.code})`)
        rebuilt = true

        if (params.verify) {
          partProgress(p, mkfsShare, `verifying ${p.name}`)
          const vdir = join(tmp, 'verify')
          await rm(vdir, { recursive: true, force: true })
          // extract.erofs -i image -x extract all -s silent -o out (extract.erofs --help).
          const x = await run(bin('extract.erofs'), ['-i', out, '-x', '-s', '-o', vdir], {
            signal: ctx.signal
          })
          if (x.code !== 0) throw new Error(`extract.erofs ${p.name} failed (exit ${x.code})`)
          const diff = await compareTrees(
            join(workDir, 'fs', p.name),
            join(vdir, p.name),
            ctx.signal,
            (done, total) =>
              partProgress(
                p,
                mkfsShare + (1 - mkfsShare) * (total ? done / total : 1),
                `verifying ${p.name}`
              )
          )
          const cfgDiff = [
            ...(await compareLineSets(
              join(cfg, `${p.name}_fs_config`),
              join(vdir, 'config', `${p.name}_fs_config`)
            )),
            ...(await compareLineSets(
              join(cfg, `${p.name}_file_contexts`),
              join(vdir, 'config', `${p.name}_file_contexts`)
            ))
          ]
          await rm(vdir, { recursive: true, force: true })
          if (diff.differences.length || cfgDiff.length) {
            for (const d of [...diff.differences, ...cfgDiff]) log(`  ${p.name}: ${d}`, 'stderr')
            throw new Error(`${p.name}: rebuilt image does not match its source tree`)
          }
          log(
            `verified ${p.name}: ${diff.files} files, ${fmt(diff.bytes)}, fs_config and file_contexts identical`
          )
          treeVerified = true
        }
      } else {
        // Not extracted (e.g. ext4 for now): reuse the stock image untouched.
        await cloneOrCopy(stockImg, out)
        info.warnings.push(`${p.name}: not rebuilt (${p.note ?? p.kind}); stock image reused`)
      }
      const size = (await stat(out)).size
      builtImage.set(p.name, out)
      info.partitions.push({
        name: p.name,
        lpName: p.lpName as string,
        size,
        sha256: await hashFile(out, ctx.signal),
        rebuilt,
        treeVerified
      })
      log(`${p.name}.img ${fmt(size)} (stock ${fmt(p.size)})`)
      doneSize += p.size
      stages.report(1, doneSize / totalSize, `built ${p.name}`)
    }

    // ---- 3: super.img with the stock layout
    stages.report(3, 0, 'lpmake')
    const dev = layout.blockDevices[0]
    if (!dev || layout.blockDevices.length !== 1)
      throw new Error('only single-device super is supported')
    const sizeOf = new Map(info.partitions.map((p) => [p.lpName, p]))
    const groupUse = new Map<string, number>()
    const lpArgs = [
      '--metadata-size',
      String(layout.metadataMaxSize),
      '--metadata-slots',
      String(layout.metadataSlotCount),
      '--device-size',
      String(dev.size),
      '--super-name',
      dev.name,
      '--block-size',
      String(layout.logicalBlockSize),
      '--alignment',
      String(dev.alignment),
      '--alignment-offset',
      String(dev.alignmentOffset ?? 0)
    ]
    for (const g of layout.groups) {
      if (g.name === 'default') continue
      lpArgs.push('--group', `${g.name}:${g.maximumSize}`)
    }
    for (const lp of layout.partitions) {
      const built = sizeOf.get(lp.name)
      const attr = lp.attributes & 1 ? 'readonly' : 'none'
      const size = built ? built.size : 0
      if (!built && lp.size > 0) throw new Error(`${lp.name} has data in stock but was not built`)
      lpArgs.push(
        '--partition',
        `${lp.name}:${attr}:${size}${lp.group && lp.group !== 'default' ? ':' + lp.group : ''}`
      )
      if (built) {
        lpArgs.push('--image', `${lp.name}=${builtImage.get(built.name)}`)
        groupUse.set(lp.group, (groupUse.get(lp.group) ?? 0) + size)
      }
    }
    for (const g of layout.groups) {
      const used = groupUse.get(g.name) ?? 0
      if (g.maximumSize > 0 && used > g.maximumSize) {
        throw new Error(`group ${g.name}: ${fmt(used)} does not fit in ${fmt(g.maximumSize)}`)
      }
    }
    if (layout.virtualAb) lpArgs.push('--virtual-ab')
    const superOut = join(imagesOut, 'super.img')
    lpArgs.push('--sparse', '--output', superOut)
    // Flags from `lpmake --help`.
    log(`lpmake ${lpArgs.join(' ')}`)
    const lr = await run(bin('lpmake'), lpArgs, { signal: ctx.signal, onLine: (l, s) => log(l, s) })
    if (lr.code !== 0) throw new Error(`lpmake failed (exit ${lr.code})`)
    stages.report(3, 1, 'super.img written')

    // ---- 4: read super.img back
    stages.report(4, 0, 'verifying super.img')
    const src = await SparseSource.open([superOut])
    try {
      const m = await readLpMetadata(src)
      const problems: string[] = []
      if (m.geometry.metadataMaxSize !== layout.metadataMaxSize) problems.push('metadata size')
      if (m.geometry.metadataSlotCount !== layout.metadataSlotCount) problems.push('metadata slots')
      if (m.geometry.logicalBlockSize !== layout.logicalBlockSize) problems.push('block size')
      if (((m.headerFlags & LP_HEADER_FLAG_VIRTUAL_AB_DEVICE) !== 0) !== layout.virtualAb)
        problems.push('virtual A/B flag')
      if (m.blockDevices[0]?.size !== dev.size) problems.push('device size')
      const groups = (gs: Array<{ name: string; maximumSize: number }>): string =>
        gs
          .map((g) => `${g.name}:${g.maximumSize}`)
          .sort()
          .join(',')
      if (groups(m.groups) !== groups(layout.groups)) problems.push('groups')
      const parts = (
        ps: Array<{ name: string; group?: string; groupName?: string; attributes: number }>
      ): string =>
        ps
          .map((p) => `${p.name}:${p.groupName ?? p.group}:${p.attributes}`)
          .sort()
          .join(',')
      if (parts(m.partitions) !== parts(layout.partitions))
        problems.push('partition names, groups or attributes')
      if (problems.length)
        throw new Error(`super.img layout differs from stock: ${problems.join(', ')}`)
      let checked = 0
      for (const bp of info.partitions) {
        throwIfCancelled(ctx.signal)
        const lp = m.partitions.find((p) => p.name === bp.lpName)
        if (!lp || lp.size !== bp.size) throw new Error(`${bp.lpName}: size in super.img differs`)
        const h = createHash('sha256')
        for (const e of lp.extents) {
          const len = e.numSectors * LP_SECTOR_SIZE
          for (let o = 0; o < len; o += 4 * 1024 * 1024) {
            h.update(
              await src.read(e.targetData * LP_SECTOR_SIZE + o, Math.min(4 * 1024 * 1024, len - o))
            )
          }
        }
        if (h.digest('hex') !== bp.sha256)
          throw new Error(`${bp.lpName}: data in super.img differs from the built image`)
        checked += bp.size
        stages.report(4, checked / totalSize, `verified ${bp.lpName} in super.img`)
      }
    } finally {
      await src.close()
    }
    info.superVerified = true
    log('super.img: layout matches stock, every partition matches its built image')
    for (const f of builtImage.values()) await rm(f, { force: true })

    // ---- 5: firmware, verity, scripts
    stages.report(5, 0, 'firmware')
    const fw = join(stockDir, 'firmware')
    for (const n of await readdir(join(fw, 'images'))) {
      // super is rebuilt; the CRC lists describe the stock images and are never flashed.
      if (/^super\.img(\.\d+)?$/.test(n) || /crclist\.txt$/.test(n)) continue
      await cloneOrCopy(join(fw, 'images', n), join(imagesOut, n))
    }
    if (params.verity === 'vbmeta-flags') {
      const p = join(imagesOut, 'vbmeta.img')
      const before = await readFile(p)
      const flags = AVB_FLAG_HASHTREE_DISABLED | AVB_FLAG_VERIFICATION_DISABLED
      const after = withVbmetaFlags(before, flags)
      await writeFile(p, after)
      info.verityChanges.push(`vbmeta.img flags ${vbmetaFlags(before)} -> ${vbmetaFlags(after)}`)
    } else {
      info.verityChanges.push(
        ...(await patchVendorBootFstab(
          bin('magiskboot'),
          join(imagesOut, 'vendor_boot.img'),
          join(tmp, 'vendor_boot'),
          log,
          ctx.signal
        ))
      )
    }
    for (const c of info.verityChanges) log(c)

    const device = stock.device ?? ''
    const stockSteps = async (name: string): Promise<ReturnType<typeof parseStockScript>> => {
      const sp = join(fw, name)
      if (!existsSync(sp))
        throw new Error(`the stock ROM has no ${name} to take the partition list from`)
      return parseStockScript(await readFile(sp, 'utf8'))
    }
    const pkg = await writePackage({
      outDir,
      commonBinDir: ctx.env.commonBinDir,
      updaterPath: ctx.env.updaterPath,
      device,
      build: id,
      generator: params.generator,
      allSteps: await stockSteps('flash_all.sh'),
      keepDataSteps: await stockSteps('flash_all_except_storage.sh'),
      signal: ctx.signal,
      log
    })
    info.scripts = pkg.scripts
    info.recoveryInstaller = pkg.recovery
    info.bundledFastboot = pkg.bundledFastboot
    if (!pkg.recovery) info.warnings.push('no recovery installer (update-binary not built)')
    stages.report(5, 1, 'package files written')

    // ---- 6: checksums
    await rm(tmp, { recursive: true, force: true })
    const files: string[] = []
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.isFile()) files.push(p)
      }
    }
    await walk(outDir)
    const sums: string[] = []
    let hashed = 0
    const totalBytes =
      (await Promise.all(files.map((f) => stat(f).then((s) => s.size)))).reduce(
        (a, b) => a + b,
        0
      ) || 1
    for (const f of files.sort()) {
      const size = (await stat(f)).size
      sums.push(`${await hashFile(f, ctx.signal)}  ${relative(outDir, f)}`)
      hashed += size
      stages.report(6, hashed / totalBytes, 'checksums')
    }
    await writeFile(join(outDir, 'checksums.sha256'), sums.join('\n') + '\n')
    await writeFile(
      join(outDir, 'README.txt'),
      [
        `${params.generator} build ${id}`,
        `Device: ${stock.device}  Base: ${stock.romVersion}`,
        `Stock input: ${stock.input.path}`,
        '',
        'Bootloader must be UNLOCKED. Never relock with this ROM installed.',
        '',
        'From a computer (fastboot is included in bin/):',
        '  macOS:   ./macos_install_upgrade.sh            keeps user data',
        '           ./macos_install_and_format_data.sh    formats user data',
        '  Linux:   ./linux_install_upgrade.sh, ./linux_install_and_format_data.sh',
        '  Windows: windows_install_upgrade.bat, windows_install_and_format_data.bat (not tested by the author)',
        '',
        pkg.recovery
          ? 'From a custom recovery (TWRP/OrangeFox): install this zip. It first checks that the firmware on both slots matches the base ROM and refuses otherwise; flash once with the scripts above in that case.'
          : 'This package has no recovery installer.',
        '',
        `Verity handling (${params.verity}):`,
        ...info.verityChanges.map((c) => `  ${c}`),
        '',
        'Verify files with: shasum -a 256 -c checksums.sha256'
      ].join('\n') + '\n'
    )
    if (params.zip) {
      stages.report(6, 1, 'zipping package')
      const name = `hyperkitchen_${device}_${stock.romVersion ?? 'rom'}_${id}.zip`.replace(
        /[^A-Za-z0-9._-]/g,
        '_'
      )
      const r = await run(
        'zip',
        ['-0', '-r', '-q', '-X', '-D', name, '.', '-x', name, 'build.json', 'build.log'],
        { cwd: outDir, signal: ctx.signal }
      )
      if (r.code !== 0) throw new Error(`zip failed (exit ${r.code}): ${r.output.slice(-300)}`)
      info.zip = name
      log(`package zip: ${name}`)
    }
    info.status = 'done'
    log(`build ${id} done: ${outDir}`)
  } catch (e) {
    info.status = e instanceof CancelledError || ctx.signal.aborted ? 'cancelled' : 'failed'
    info.error = (e as Error).message
    log(`build ${info.status}: ${info.error}`, 'stderr')
    await rm(tmp, { recursive: true, force: true })
    throw e
  } finally {
    info.finishedAt = new Date().toISOString()
    await writeFile(join(outDir, 'build.json'), JSON.stringify(info, null, 2))
    await writeFile(join(outDir, 'build.log'), logLines.join('\n') + '\n')
  }
  return info
}
