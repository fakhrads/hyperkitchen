#!/usr/bin/env node
// Download the pinned host binaries listed in resources/bin/manifest.json into
// resources/bin/<platform>/ (and resources/bin/common/ for jars).
//
//   node scripts/fetch-bins.mjs                  current platform + common
//   node scripts/fetch-bins.mjs --platform darwin-arm64,darwin-x64
//   node scripts/fetch-bins.mjs --all
//
// Every download is checked against the sha256 in the manifest before use.
// Downloads are cached in .cache/bins/ keyed by sha256.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const binRoot = join(root, 'resources', 'bin')
const cacheDir = join(root, '.cache', 'bins')
const manifest = JSON.parse(readFileSync(join(binRoot, 'manifest.json'), 'utf8'))
const ALL = ['darwin-arm64', 'darwin-x64', 'linux-x64']

function currentKey() {
  const k = `${process.platform === 'darwin' ? 'darwin' : process.platform}-${process.arch}`
  return ALL.includes(k) ? k : null
}

function parseArgs() {
  const a = process.argv.slice(2)
  if (a.includes('--all')) return ALL
  const i = a.indexOf('--platform')
  if (i >= 0) {
    const list = (a[i + 1] ?? '').split(',').filter(Boolean)
    for (const p of list) if (!ALL.includes(p)) throw new Error(`unknown platform ${p}`)
    return list
  }
  const k = currentKey()
  if (!k) throw new Error(`unsupported host ${process.platform}-${process.arch}; pass --platform`)
  return [k]
}

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

async function fetchCached(url, sha256) {
  mkdirSync(cacheDir, { recursive: true })
  const cached = join(cacheDir, sha256)
  if (existsSync(cached) && sha256File(cached) === sha256) return cached
  process.stdout.write(`  downloading ${url}\n`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = createHash('sha256').update(buf).digest('hex')
  if (got !== sha256)
    throw new Error(`sha256 mismatch for ${url}\n  expected ${sha256}\n  got      ${got}`)
  writeFileSync(cached + '.part', buf)
  renameSync(cached + '.part', cached)
  return cached
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
    ...opts
  })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr?.toString()}`)
  return r.stdout
}

function extract(archivePath, art, dest) {
  if (art.archive === 'raw') return copyFileSync(archivePath, dest)
  const tmp = mkdtempSync(join(cacheDir, 'x-'))
  try {
    if (art.archive === 'zip')
      writeFileSync(join(tmp, 'out'), sh('unzip', ['-p', archivePath, art.member]))
    else if (art.archive === 'tar.gz') {
      sh('tar', ['-xzf', archivePath, '-C', tmp, art.member])
      renameSync(join(tmp, art.member), join(tmp, 'out'))
    } else throw new Error(`unknown archive type ${art.archive}`)
    copyFileSync(join(tmp, 'out'), dest)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function install(key, tools) {
  const dir = join(binRoot, key)
  mkdirSync(dir, { recursive: true })
  const stampPath = join(dir, '.stamp.json')
  const stamp = existsSync(stampPath) ? JSON.parse(readFileSync(stampPath, 'utf8')) : {}
  console.log(`[${key}]`)
  for (const t of tools) {
    const art = t.artifacts[key]
    if (!art) continue
    const dest = join(dir, t.file)
    mkdirSync(dirname(dest), { recursive: true })
    if (existsSync(dest) && stamp[t.id] === art.sha256) {
      console.log(`  ok   ${t.id} (cached)`)
      continue
    }
    const file = await fetchCached(art.url, art.sha256)
    extract(file, art, dest)
    if (t.kind === 'native' || t.executable) chmodSync(dest, 0o755)
    stamp[t.id] = art.sha256
    console.log(`  new  ${t.id} ${t.version}`)
  }
  writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + '\n')
}

const platforms = parseArgs()
for (const p of platforms)
  await install(
    p,
    manifest.tools.filter((t) => t.kind === 'native')
  )
await install(
  'common',
  manifest.tools.filter((t) => t.kind === 'jar' || t.kind === 'payload')
)
console.log('done')
