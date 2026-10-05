// Turns a build folder into a xiaomi.eu style package: one zip that installs both ways.
//
//   images/                      firmware, boot images, super.img
//   bin/{macos,linux,windows}/   pinned platform-tools fastboot (Google, sha256 checked)
//   {macos,linux}_*.sh, windows_*.bat
//       install_upgrade            keep data
//       install_and_format_data    flash everything and format data
//       format_data_only           format data only
//   META-INF/com/google/android/update-binary   HyperKitchen updater (TWRP/OrangeFox)
//   META-INF/com/google/android/updater-script  placeholder; the logic is in update-binary
//   hk-install.json              what the updater checks and writes
//
// The fastboot scripts and the updater never write the recovery partition from recovery and
// never relock. HyperKitchen only produces these files; the user runs them.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CancelledError } from './context'
import { isSparseFile, SparseSource } from './formats/sparse'
import { cloneOrCopy, hashFile } from './fsutil'
import { renderBatch, renderScript, type FlashStep } from './flashscript'

/** Written to both slots by the updater; everything else flashed as *_ab is only checked. */
export const BOOT_CHAIN = new Set([
  'boot',
  'init_boot',
  'vendor_boot',
  'dtbo',
  'vbmeta',
  'vbmeta_system'
])
/** Flashed by the stock scripts but neither checked nor written from recovery. */
const NOT_CHECKED = new Set(['recovery', 'countrycode'])

export interface RegionHash {
  offset: number
  length: number
  sha256: string
}

export interface InstallManifest {
  schema: 1
  device: string
  build: string
  generator: string
  firmware: Array<{ partition: string; regions: RegionHash[] }>
  write: Array<{
    entry: string
    partition: string
    slots: string[]
    sha256: string
    sparse: boolean
  }>
  super: { entry: string; partition: string; slots: string[]; sha256: string; sparse: boolean }
  activeSlot: 'a'
}

/** The byte ranges fastboot writes for an image: the whole file, or a sparse image's data. */
export async function imageRegions(path: string, signal: AbortSignal): Promise<RegionHash[]> {
  if (!(await isSparseFile(path))) {
    return [{ offset: 0, length: (await stat(path)).size, sha256: await hashFile(path, signal) }]
  }
  const src = await SparseSource.open([path])
  try {
    const out: RegionHash[] = []
    for (const e of src.extents) {
      const h = createHash('sha256')
      for (let o = 0; o < e.len; o += 4 * 1024 * 1024) {
        if (signal.aborted) throw new CancelledError()
        h.update(await src.read(e.start + o, Math.min(4 * 1024 * 1024, e.len - o)))
      }
      out.push({ offset: e.start, length: e.len, sha256: h.digest('hex') })
    }
    return out
  } finally {
    await src.close()
  }
}

export async function installManifest(opts: {
  outDir: string
  device: string
  build: string
  generator: string
  steps: FlashStep[]
  signal: AbortSignal
}): Promise<InstallManifest> {
  const firmware: InstallManifest['firmware'] = []
  const write: InstallManifest['write'] = []
  for (const s of opts.steps) {
    if (s.op !== 'flash' || !s.args[0].endsWith('_ab')) continue
    const part = s.args[0].slice(0, -3)
    const file = join(opts.outDir, s.args[1])
    if (BOOT_CHAIN.has(part)) {
      if (await isSparseFile(file))
        throw new Error(`${s.args[1]}: sparse boot images are not supported`)
      write.push({
        entry: s.args[1],
        partition: part,
        slots: ['a', 'b'],
        sha256: await hashFile(file, opts.signal),
        sparse: false
      })
    } else if (!NOT_CHECKED.has(part)) {
      firmware.push({ partition: part, regions: await imageRegions(file, opts.signal) })
    }
  }
  const superStep = opts.steps.find((s) => s.op === 'flash' && s.args[0] === 'super')
  if (!superStep) throw new Error('the stock script does not flash super')
  return {
    schema: 1,
    device: opts.device,
    build: opts.build,
    generator: opts.generator,
    firmware,
    write,
    super: {
      entry: superStep.args[1],
      partition: 'super',
      slots: [],
      sha256: await hashFile(join(opts.outDir, superStep.args[1]), opts.signal),
      sparse: true
    },
    activeSlot: 'a'
  }
}

const PAYLOADS: Array<[string, string, boolean]> = [
  ['platform-tools/macos/fastboot', 'bin/macos/fastboot', true],
  ['platform-tools/linux/fastboot', 'bin/linux/fastboot', true],
  ['platform-tools/windows/fastboot.exe', 'bin/windows/fastboot.exe', false],
  ['platform-tools/windows/AdbWinApi.dll', 'bin/windows/AdbWinApi.dll', false],
  ['platform-tools/windows/AdbWinUsbApi.dll', 'bin/windows/AdbWinUsbApi.dll', false],
  ['platform-tools/NOTICE.txt', 'bin/NOTICE-platform-tools.txt', false]
]

export interface PackageResult {
  scripts: string[]
  bundledFastboot: boolean
  recovery: boolean
}

export async function writePackage(opts: {
  outDir: string
  commonBinDir: string
  updaterPath: string | undefined
  device: string
  build: string
  generator: string
  /** Steps of the stock flash_all.sh (wipes data) and flash_all_except_storage.sh. */
  allSteps: FlashStep[]
  keepDataSteps: FlashStep[]
  signal: AbortSignal
  log: (s: string) => void
}): Promise<PackageResult> {
  const { outDir } = opts
  const has = (p: string): boolean => existsSync(join(outDir, p))
  const missing = [...opts.allSteps, ...opts.keepDataSteps]
    .filter((s) => s.op === 'flash')
    .map((s) => s.args[1])
    .filter((f) => !has(f))
  if (missing.length)
    throw new Error(`the flash scripts need missing files: ${[...new Set(missing)].join(', ')}`)

  // fastboot binaries, as xiaomi.eu ships them.
  let bundledFastboot = true
  for (const [src, dst, exec] of PAYLOADS) {
    const from = join(opts.commonBinDir, src)
    if (!existsSync(from)) {
      bundledFastboot = false
      continue
    }
    await mkdir(join(outDir, dst, '..'), { recursive: true })
    await cloneOrCopy(from, join(outDir, dst))
    if (exec) await chmod(join(outDir, dst), 0o755)
  }
  if (!bundledFastboot)
    opts.log('platform-tools not fetched: the scripts will use fastboot from PATH')

  // Data steps: what flash_all.sh does beyond flash_all_except_storage.sh.
  const key = (s: FlashStep): string => `${s.op} ${s.args.join(' ')}`
  const keep = new Set(opts.keepDataSteps.map(key))
  const dataSteps = opts.allSteps.filter((s) => !keep.has(key(s)))
  const formatOnly: FlashStep[] = [
    { op: 'set_active', args: ['a'] },
    ...dataSteps,
    { op: 'reboot', args: [] }
  ]
  const anti = has('images/anti_version.txt')
  const variants: Array<[string, FlashStep[], boolean, string]> = [
    [
      'install_upgrade',
      opts.keepDataSteps,
      false,
      'Your device will be flashed without formatting the data partition. You keep apps, settings and files.'
    ],
    [
      'install_and_format_data',
      opts.allSteps,
      true,
      'Your device will be flashed and the data partition FORMATTED. You lose apps, settings and files on internal storage.'
    ],
    [
      'format_data_only',
      formatOnly,
      true,
      'The data partition will be FORMATTED (factory reset). Nothing else is flashed.'
    ]
  ]
  const scripts: string[] = []
  for (const [variant, steps, wipes, message] of variants) {
    for (const os of ['macos', 'linux'] as const) {
      const name = `${os}_${variant}.sh`
      await writeFile(
        join(outDir, name),
        renderScript({
          device: opts.device,
          antiVersionFile: anti,
          wipesData: wipes,
          steps,
          generator: opts.generator,
          bundled: `bin/${os}/fastboot`,
          message
        }),
        { mode: 0o755 }
      )
      scripts.push(name)
    }
    const bat = `windows_${variant}.bat`
    await writeFile(
      join(outDir, bat),
      renderBatch({
        device: opts.device,
        antiVersionFile: anti,
        steps,
        generator: opts.generator,
        message
      })
    )
    scripts.push(bat)
  }

  // Recovery installer.
  let recovery = false
  if (opts.updaterPath && existsSync(opts.updaterPath)) {
    const meta = join(outDir, 'META-INF', 'com', 'google', 'android')
    await mkdir(meta, { recursive: true })
    await cloneOrCopy(opts.updaterPath, join(meta, 'update-binary'))
    await chmod(join(meta, 'update-binary'), 0o755)
    await writeFile(
      join(meta, 'updater-script'),
      '# HyperKitchen: the installation logic is in update-binary (TWRP / OrangeFox).\n'
    )
    const manifest = await installManifest({
      outDir,
      device: opts.device,
      build: opts.build,
      generator: opts.generator,
      steps: opts.keepDataSteps,
      signal: opts.signal
    })
    await writeFile(join(outDir, 'hk-install.json'), JSON.stringify(manifest, null, 2))
    recovery = true
  } else {
    opts.log('update-binary not built (pnpm build-updater): the package has no recovery installer')
  }

  return { scripts, bundledFastboot, recovery }
}
