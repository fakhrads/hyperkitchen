import { constants as fsc } from 'node:fs'
import { access, copyFile, mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BinManifest,
  DoctorCheck,
  DoctorReport,
  ManifestTool,
  PlatformKey
} from '../shared/types'
import { platformKey } from '../shared/platform'
import type { WorkerEnv } from '../shared/worker-protocol'
import type { JobContext } from './context'
import { detectJava, MIN_JAVA_MAJOR } from './java'
import { run } from './spawn'

/** A full HyperOS ROM unpacked plus a work copy needs roughly this much. */
const DISK_WARN_BYTES = 60 * 1024 ** 3

export async function loadManifest(path: string): Promise<BinManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as BinManifest
}

/** Match probe output against the manifest regex. Group 1, if any, is the version. */
export function matchProbe(output: string, pattern: string): { ok: boolean; version?: string } {
  const m = output.match(new RegExp(pattern, 'm'))
  if (!m) return { ok: false }
  return { ok: true, version: m[1] }
}

async function checkTool(
  tool: ManifestTool,
  dir: string,
  javaPath: string | null
): Promise<DoctorCheck> {
  const base = {
    id: `bin:${tool.id}`,
    group: 'binaries' as const,
    label: tool.id,
    neededFor: tool.neededFor
  }
  const file = join(dir, tool.file)
  try {
    await access(file, tool.kind === 'native' ? fsc.X_OK : fsc.R_OK)
  } catch {
    return { ...base, status: 'error', detail: `missing: ${file} (run "pnpm fetch-bins")` }
  }
  if (tool.kind === 'payload' || !tool.probe) {
    return { ...base, status: 'ok', detail: file, version: tool.version }
  }
  if (tool.kind === 'jar' && !javaPath) {
    return { ...base, status: 'warn', detail: 'present, cannot probe without Java' }
  }
  const [cmd, args] =
    tool.kind === 'jar'
      ? [javaPath as string, ['-jar', file, ...tool.probe.args]]
      : [file, tool.probe.args]
  try {
    const r = await run(cmd, args, { timeoutMs: 30000 })
    const m = matchProbe(r.output, (tool.probe as { match: string }).match)
    if (!m.ok) {
      return {
        ...base,
        status: 'error',
        detail: `probe output not recognised: ${r.output.slice(0, 200)}`
      }
    }
    return { ...base, status: 'ok', detail: file, version: m.version ?? tool.version }
  } catch (e) {
    return { ...base, status: 'error', detail: `cannot execute: ${(e as Error).message}` }
  }
}

/** Mount point from `df -P <path>` output (last line; the mount point may contain spaces). */
export function parseDfMountPoint(output: string): string | null {
  const last = output.trim().split('\n').pop() ?? ''
  const m = last.match(/\s\d+%\s+(.+)$/)
  return m ? m[1] : null
}

/** Filesystem type of mountPoint from macOS `mount` output: "<dev> on <mp> (<type>, ...)". */
export function parseMountType(output: string, mountPoint: string): string | null {
  for (const line of output.split('\n')) {
    const i = line.indexOf(` on ${mountPoint} (`)
    if (i < 0) continue
    const rest = line.slice(i + ` on ${mountPoint} (`.length)
    return rest.split(/[,)]/)[0].trim()
  }
  return null
}

/** True when the filesystem under dir supports copy-on-write clones (APFS, btrfs, xfs). */
export async function supportsClone(dir: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    // libuv only clones through the Linux FICLONE ioctl: on macOS COPYFILE_FICLONE_FORCE
    // always fails with ENOSYS and COPYFILE_FICLONE silently does a full copy. `cp -c`
    // falls back to a full copy silently too, so ask for the filesystem type instead.
    await mkdir(dir, { recursive: true })
    const df = await run('df', ['-P', dir], { timeoutMs: 15000 })
    const mp = df.code === 0 ? parseDfMountPoint(df.output) : null
    if (!mp) return false
    const mount = await run('mount', [], { timeoutMs: 15000 })
    return mount.code === 0 && parseMountType(mount.output, mp) === 'apfs'
  }
  const probeDir = join(dir, '.hk-clone-probe')
  await mkdir(probeDir, { recursive: true })
  const a = join(probeDir, 'a')
  const b = join(probeDir, 'b')
  try {
    await writeFile(a, 'clone probe')
    await copyFile(a, b, fsc.COPYFILE_FICLONE_FORCE)
    return true
  } catch {
    return false
  } finally {
    await rm(probeDir, { recursive: true, force: true })
  }
}

/** False when "a" and "A" name the same file under dir (APFS default, exFAT, NTFS). */
export async function caseSensitive(dir: string): Promise<boolean> {
  const probeDir = join(dir, '.hk-case-probe')
  await mkdir(probeDir, { recursive: true })
  try {
    await writeFile(join(probeDir, 'a'), '')
    try {
      await access(join(probeDir, 'A'))
      return false
    } catch {
      return true
    }
  } finally {
    await rm(probeDir, { recursive: true, force: true })
  }
}

async function quarantined(dir: string): Promise<boolean> {
  // xattr -r -l prints one line per attribute; any com.apple.quarantine means Gatekeeper may block.
  try {
    const r = await run('xattr', ['-r', '-l', dir], { timeoutMs: 15000 })
    return r.output.includes('com.apple.quarantine')
  } catch {
    return false
  }
}

export async function runDoctor(ctx: JobContext): Promise<DoctorReport> {
  const env: WorkerEnv = ctx.env
  const key: PlatformKey | null = platformKey(env.platform, env.arch)
  const checks: DoctorCheck[] = []

  checks.push({
    id: 'host:platform',
    group: 'host',
    label: 'Host platform',
    status: key ? 'ok' : 'error',
    detail:
      key ?? `${env.platform}-${env.arch} is not supported (darwin-arm64, darwin-x64, linux-x64)`
  })

  ctx.progress(0.05, 'Java')
  const java = await detectJava(env)
  checks.push({
    id: 'java',
    group: 'java',
    label: 'Java runtime',
    neededFor: 'M6-M8 (APKEditor, Apktool, smali)',
    status: !java ? 'warn' : java.major >= MIN_JAVA_MAJOR ? 'ok' : 'error',
    version: java?.version,
    detail: !java
      ? `not found; install a managed Temurin JRE from this screen (needs ${MIN_JAVA_MAJOR}+)`
      : java.major >= MIN_JAVA_MAJOR
        ? `${java.path} (${java.source})`
        : `${java.path} is Java ${java.major}, need ${MIN_JAVA_MAJOR}+`
  })

  ctx.progress(0.1, 'Binaries')
  let manifest: BinManifest | null = null
  try {
    manifest = await loadManifest(env.manifestPath)
  } catch (e) {
    checks.push({
      id: 'bin:manifest',
      group: 'binaries',
      label: 'Binary manifest',
      status: 'error',
      detail: `cannot read ${env.manifestPath}: ${(e as Error).message}`
    })
  }
  if (manifest && key) {
    const tools = manifest.tools.filter((t) =>
      t.kind === 'native' ? t.artifacts[key] : t.artifacts.common
    )
    for (const [i, tool] of tools.entries()) {
      ctx.progress(0.1 + (0.7 * i) / tools.length, `Probing ${tool.id}`)
      const dir = tool.kind === 'native' ? env.binDir : env.commonBinDir
      if (!dir) continue
      const c = await checkTool(tool, dir, java && java.major >= MIN_JAVA_MAJOR ? java.path : null)
      ctx.log(`${c.status.padEnd(5)} ${tool.id} ${c.version ?? ''}`)
      checks.push(c)
    }
  }

  ctx.progress(0.85, 'Host')
  for (const tool of ['tar', 'unzip', 'zip']) {
    let ok = false
    try {
      const r = await run(tool, tool === 'tar' ? ['--version'] : ['-v'], { timeoutMs: 10000 })
      ok = r.output.length > 0
    } catch {
      ok = false
    }
    checks.push({
      id: `host:${tool}`,
      group: 'host',
      label: `${tool} on PATH`,
      status: ok ? 'ok' : 'error',
      detail: ok ? 'found' : 'not found'
    })
  }

  try {
    await mkdir(env.projectsRoot, { recursive: true })
    const s = await statfs(env.projectsRoot)
    const free = s.bavail * s.bsize
    checks.push({
      id: 'host:disk',
      group: 'host',
      label: 'Free space in projects folder',
      status: free >= DISK_WARN_BYTES ? 'ok' : 'warn',
      detail: `${(free / 1024 ** 3).toFixed(1)} GB free at ${env.projectsRoot}${
        free >= DISK_WARN_BYTES ? '' : ' (a full ROM project needs about 60 GB)'
      }`
    })
    const clone = await supportsClone(env.projectsRoot)
    checks.push({
      id: 'host:clone',
      group: 'host',
      label: 'Copy-on-write clones',
      status: clone ? 'ok' : 'warn',
      detail: clone
        ? 'supported: build copies are instant and use no extra space'
        : 'not supported on this filesystem: each build makes a full copy of the ROM tree (slower, more disk)'
    })
    const cs = await caseSensitive(env.projectsRoot)
    checks.push({
      id: 'host:case',
      group: 'host',
      label: 'Case-sensitive file names',
      status: cs ? 'ok' : 'warn',
      detail: cs
        ? 'yes'
        : 'no: Android trees can hold names that differ only in case, which would overwrite each other here. Use a case-sensitive volume (on macOS: APFS Case-sensitive, e.g. a disk image)'
    })
  } catch (e) {
    checks.push({
      id: 'host:disk',
      group: 'host',
      label: 'Projects folder',
      status: 'error',
      detail: `cannot use ${env.projectsRoot}: ${(e as Error).message}`
    })
  }

  if (env.platform === 'darwin' && env.binDir) {
    const q = await quarantined(env.binDir)
    checks.push({
      id: 'host:quarantine',
      group: 'host',
      label: 'Gatekeeper quarantine on bundled binaries',
      status: q ? 'warn' : 'ok',
      detail: q
        ? 'binaries carry com.apple.quarantine and may be blocked; use "Clear quarantine"'
        : 'none'
    })
  }

  ctx.progress(1, 'Done')
  return { generatedAt: new Date().toISOString(), platformKey: key, checks, java }
}

/** Remove com.apple.quarantine from our own bin dir only. */
export async function clearQuarantine(ctx: JobContext): Promise<void> {
  const dir = ctx.env.binDir
  if (ctx.env.platform !== 'darwin' || !dir) throw new Error('only applies to macOS')
  const r = await run('xattr', ['-r', '-d', 'com.apple.quarantine', dir], { signal: ctx.signal })
  ctx.log(r.output || 'quarantine attribute removed')
}
