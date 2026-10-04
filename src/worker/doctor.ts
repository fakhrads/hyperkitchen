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
  if (tool.kind === 'jar' && !javaPath) {
    return { ...base, status: 'warn', detail: 'present, cannot probe without Java' }
  }
  const [cmd, args] =
    tool.kind === 'jar'
      ? [javaPath as string, ['-jar', file, ...tool.probe.args]]
      : [file, tool.probe.args]
  try {
    const r = await run(cmd, args, { timeoutMs: 30000 })
    const m = matchProbe(r.output, tool.probe.match)
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

/** True when the filesystem under dir supports copy-on-write clones (APFS, btrfs, xfs). */
export async function supportsClone(dir: string): Promise<boolean> {
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
      t.kind === 'jar' ? t.artifacts.common : t.artifacts[key]
    )
    for (const [i, tool] of tools.entries()) {
      ctx.progress(0.1 + (0.7 * i) / tools.length, `Probing ${tool.id}`)
      const dir = tool.kind === 'jar' ? env.commonBinDir : env.binDir
      if (!dir) continue
      const c = await checkTool(tool, dir, java && java.major >= MIN_JAVA_MAJOR ? java.path : null)
      ctx.log(`${c.status.padEnd(5)} ${tool.id} ${c.version ?? ''}`)
      checks.push(c)
    }
  }

  ctx.progress(0.85, 'Host')
  for (const tool of ['tar', 'unzip']) {
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
