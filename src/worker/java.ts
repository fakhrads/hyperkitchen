import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JavaInfo } from '../shared/types'
import type { WorkerEnv } from '../shared/worker-protocol'
import { type JobContext, throwIfCancelled } from './context'
import { downloadVerified } from './download'
import { run } from './spawn'

export const MIN_JAVA_MAJOR = 17
const TEMURIN_FEATURE = 21

/** Parse `java -version` output. Handles both "21.0.4" and legacy "1.8.0_402". */
export function parseJavaVersion(output: string): { version: string; major: number } | null {
  const m = output.match(/version "([^"]+)"/)
  if (!m) return null
  const version = m[1]
  const parts = version.split(/[.+_-]/)
  let major = Number(parts[0])
  if (major === 1 && parts.length > 1) major = Number(parts[1])
  if (!Number.isFinite(major)) return null
  return { version, major }
}

async function probeJava(path: string): Promise<{ version: string; major: number } | null> {
  try {
    const r = await run(path, ['-version'], { timeoutMs: 15000 })
    return parseJavaVersion(r.output)
  } catch {
    return null
  }
}

function managedPointer(env: WorkerEnv): string {
  return join(env.managedJreDir, 'current.json')
}

async function managedJavaPath(env: WorkerEnv): Promise<string | null> {
  try {
    const j = JSON.parse(await readFile(managedPointer(env), 'utf8')) as { javaPath?: string }
    return j.javaPath && existsSync(j.javaPath) ? j.javaPath : null
  } catch {
    return null
  }
}

/** Find a usable Java in priority order: settings, managed JRE, JAVA_HOME, PATH. */
export async function detectJava(env: WorkerEnv): Promise<JavaInfo | null> {
  const candidates: Array<{ path: string; source: JavaInfo['source'] }> = []
  if (env.javaPathSetting) candidates.push({ path: env.javaPathSetting, source: 'settings' })
  const managed = await managedJavaPath(env)
  if (managed) candidates.push({ path: managed, source: 'managed' })
  if (process.env.JAVA_HOME) {
    candidates.push({ path: join(process.env.JAVA_HOME, 'bin', 'java'), source: 'JAVA_HOME' })
  }
  candidates.push({ path: 'java', source: 'PATH' })

  for (const c of candidates) {
    const v = await probeJava(c.path)
    if (v) return { path: c.path, version: v.version, major: v.major, source: c.source }
  }
  return null
}

interface AdoptiumPackage {
  link: string
  checksum: string
  size: number
  name: string
}

/** Adoptium API naming: os = linux | mac, architecture = x64 | aarch64. */
export function adoptiumQuery(platform: string, arch: string): string {
  const os = platform === 'darwin' ? 'mac' : platform
  const a = arch === 'arm64' ? 'aarch64' : arch
  return `https://api.adoptium.net/v3/assets/latest/${TEMURIN_FEATURE}/hotspot?image_type=jre&os=${os}&architecture=${a}`
}

async function findJavaBinary(root: string): Promise<string | null> {
  // Linux layout: <dir>/bin/java. macOS layout: <dir>/Contents/Home/bin/java.
  for (const entry of await readdir(root)) {
    for (const rel of ['bin/java', 'Contents/Home/bin/java']) {
      const p = join(root, entry, rel)
      if (existsSync(p)) return p
    }
  }
  return null
}

/** Download Temurin JRE into the app data dir. Never touches system Java. */
export async function installManagedJre(ctx: JobContext): Promise<JavaInfo> {
  const { env, signal } = ctx
  ctx.progress(null, 'Querying Adoptium API')
  const res = await fetch(adoptiumQuery(env.platform, env.arch), { signal })
  if (!res.ok) throw new Error(`Adoptium API HTTP ${res.status}`)
  const assets = (await res.json()) as Array<{
    binary: { package: AdoptiumPackage }
    release_name: string
  }>
  if (!assets.length) throw new Error('Adoptium returned no JRE for this platform')
  const pkg = assets[0].binary.package
  ctx.log(`Temurin ${assets[0].release_name}: ${pkg.name} (${(pkg.size / 1048576).toFixed(1)} MB)`)

  const dlDir = join(env.managedJreDir, 'downloads')
  await mkdir(dlDir, { recursive: true })
  const archive = join(dlDir, pkg.name)
  await downloadVerified(pkg.link, archive, pkg.checksum, {
    signal,
    onProgress: (got, total) => ctx.progress(total ? (got / total) * 0.9 : null, 'Downloading JRE')
  })
  ctx.log('sha256 verified')
  throwIfCancelled(signal)

  ctx.progress(0.92, 'Extracting')
  const target = join(env.managedJreDir, assets[0].release_name)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  const r = await run('tar', ['-xzf', archive, '-C', target], { signal })
  if (r.code !== 0) throw new Error(`tar failed (${r.code}): ${r.output.slice(-500)}`)
  await rm(archive, { force: true })

  const javaPath = await findJavaBinary(target)
  if (!javaPath) throw new Error('java binary not found in extracted JRE')
  const v = await probeJava(javaPath)
  if (!v) throw new Error(`extracted java does not run: ${javaPath}`)
  await writeFile(
    managedPointer(env),
    JSON.stringify({ javaPath, release: assets[0].release_name }, null, 2)
  )
  ctx.progress(1, 'Done')
  ctx.log(`Installed ${javaPath} (${v.version})`)
  return { path: javaPath, version: v.version, major: v.major, source: 'managed' }
}
