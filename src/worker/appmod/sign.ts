// Re-signing with the project key, only for the adb install package of an app mod.
//
// The key is a PKCS#12 keystore made once per project with the JRE's keytool
// (`keytool -genkeypair -storetype PKCS12 -storepass:file`), kept in <project>/keys/ with a
// random password file. apksigner (build-tools, pinned in the manifest) signs with
// `--ks <file> --ks-pass file:<file> --ks-key-alias hk` and replaces every existing signature
// (v1 files and the APK Signing Block). `apksigner verify --print-certs` checks the result.
//
// An app signed with this key is a different app to Android: it cannot update the copy
// signed by Xiaomi, and it no longer receives store or OTA updates.

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { run } from '../spawn'

export const KEY_ALIAS = 'hk'

export interface ProjectKey {
  keystore: string
  passwordFile: string
}

export function projectKeyPaths(projectPath: string): ProjectKey {
  const dir = join(projectPath, 'keys')
  return { keystore: join(dir, 'hk-project.p12'), passwordFile: join(dir, 'hk-project.password') }
}

/** keytool next to the java binary in use (the JRE ships both). */
export function keytoolFor(java: string): string {
  const exe = process.platform === 'win32' ? 'keytool.exe' : 'keytool'
  return java.includes('/') || java.includes('\\') ? join(dirname(java), exe) : exe
}

export async function ensureProjectKey(opts: {
  projectPath: string
  java: string
  signal: AbortSignal
  log: (s: string) => void
}): Promise<ProjectKey> {
  const k = projectKeyPaths(opts.projectPath)
  if (existsSync(k.keystore) && existsSync(k.passwordFile)) return k
  if (existsSync(k.keystore))
    throw new Error(`${k.keystore} exists without its password file; restore it or remove both`)
  await mkdir(dirname(k.keystore), { recursive: true })
  await writeFile(k.passwordFile, randomBytes(24).toString('hex') + '\n', { mode: 0o600 })
  await chmod(k.passwordFile, 0o600)
  const name = basename(opts.projectPath).replace(/[,=+<>#;"\\]/g, ' ')
  // keytool -genkeypair (keytool -genkeypair -help).
  const r = await run(
    keytoolFor(opts.java),
    [
      '-genkeypair',
      '-keystore',
      k.keystore,
      '-storetype',
      'PKCS12',
      '-storepass:file',
      k.passwordFile,
      '-alias',
      KEY_ALIAS,
      '-keyalg',
      'RSA',
      '-keysize',
      '4096',
      '-validity',
      '10000',
      '-dname',
      `CN=HyperKitchen project ${name}`
    ],
    { signal: opts.signal }
  )
  if (r.code !== 0 || !existsSync(k.keystore))
    throw new Error(`keytool failed: ${r.output.slice(-400)}`)
  await chmod(k.keystore, 0o600)
  opts.log(`created the project signing key ${k.keystore}`)
  return k
}

async function apksigner(
  java: string,
  jar: string,
  args: string[],
  signal: AbortSignal
): Promise<string> {
  // --enable-native-access silences the JDK 24+ warning about conscrypt's native library.
  const r = await run(java, ['--enable-native-access=ALL-UNNAMED', '-jar', jar, ...args], {
    signal
  })
  if (r.code !== 0) throw new Error(`apksigner ${args[0]} failed: ${r.output.slice(-600)}`)
  return r.output
}

export async function signApk(opts: {
  java: string
  apksigner: string
  key: ProjectKey
  input: string
  output: string
  signal: AbortSignal
}): Promise<{ certSha256: string; schemes: string[] }> {
  await apksigner(
    opts.java,
    opts.apksigner,
    [
      'sign',
      '--ks',
      opts.key.keystore,
      '--ks-pass',
      `file:${opts.key.passwordFile}`,
      '--ks-key-alias',
      KEY_ALIAS,
      '--out',
      opts.output,
      opts.input
    ],
    opts.signal
  )
  const out = await apksigner(
    opts.java,
    opts.apksigner,
    ['verify', '--print-certs', '-v', opts.output],
    opts.signal
  )
  return parseVerify(out)
}

/** The parts of `apksigner verify --print-certs -v` output HyperKitchen relies on. */
export function parseVerify(out: string): { certSha256: string; schemes: string[] } {
  if (!/^Verifies$/m.test(out)) throw new Error(`apksigner verify: ${out.slice(-400)}`)
  const signers = Number(out.match(/^Number of signers: (\d+)$/m)?.[1] ?? 0)
  if (signers !== 1) throw new Error(`expected one signer, apksigner reports ${signers}`)
  const cert = out.match(/Signer(?: #1)?: certificate SHA-256 digest: ([0-9a-f]{64})/)?.[1]
  if (!cert) throw new Error('apksigner verify printed no certificate digest')
  const schemes = [...out.matchAll(/^Verified using (v[\d.]+) scheme \([^)]*\): true$/gm)].map(
    (m) => m[1]
  )
  return { certSha256: cert, schemes }
}
