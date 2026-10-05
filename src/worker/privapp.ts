// Privileged permission allowlist check: the reason a ROM with new priv-apps (GApps) bootloops.
//
// AOSP PermissionManagerServiceImpl.checkPrivilegedPermissionAllowlist: when
// ro.control_privapp_permissions=enforce, a privileged app on a system partition that requests
// a privileged permission defined by the platform (package "android") must have it in the
// allowlist of its own partition, or boot fails with "Signature|privileged permissions not in
// privapp-permissions allowlist". SystemConfig keeps one allowlist per partition: files under
// vendor+odm, product, system_ext and system grant only to apps on that same partition
// (getPrivilegedPermissionAllowlistState). A <deny-permission> also counts as listed.
//
// Paths are taken from the runtime view (runtimeview.ts): on HyperOS /product/priv-app and
// /system/etc/permissions are overlayfs stacks of several trees.
//
// Constants: PermissionInfo.PROTECTION_FLAG_PRIVILEGED = 0x10.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAxml, type AxmlAttr } from './formats/axml'
import { ZipFile } from './formats/zip'
import { RuntimeView } from './runtimeview'

const PROTECTION_FLAG_PRIVILEGED = 0x10
const ATTR_NAME = 0x01010003
const ATTR_PROTECTION_LEVEL = 0x01010009
const ATTR_MAX_SDK = 0x01010271

type Scope = 'system' | 'system_ext' | 'product' | 'vendor'

/** Device directories per allowlist scope (SystemConfig.readAllPermissions). */
const SCOPES: Record<Scope, { config: string[]; apps: string[] }> = {
  system: {
    config: ['/system/etc/sysconfig', '/system/etc/permissions'],
    apps: ['/system/priv-app']
  },
  system_ext: {
    config: ['/system_ext/etc/sysconfig', '/system_ext/etc/permissions'],
    apps: ['/system_ext/priv-app']
  },
  product: {
    config: ['/product/etc/sysconfig', '/product/etc/permissions'],
    apps: ['/product/priv-app']
  },
  vendor: {
    config: [
      '/vendor/etc/sysconfig',
      '/vendor/etc/permissions',
      '/odm/etc/sysconfig',
      '/odm/etc/permissions'
    ],
    apps: ['/vendor/priv-app', '/odm/priv-app']
  }
}

export interface PrivappViolation {
  scope: Scope
  packageName: string
  apk: string
  permission: string
}

export interface PrivappReport {
  /** Every value of ro.control_privapp_permissions set in the trees' build.prop files. */
  modes: string[]
  /** Any of them is enforce: violations make PackageManager abort the boot. */
  enforced: boolean
  privilegedPermissions: number
  appsChecked: number
  violations: PrivappViolation[]
}

const attr = (attrs: AxmlAttr[], id: number, name: string): AxmlAttr | undefined =>
  attrs.find((a) => a.resId === id) ?? attrs.find((a) => a.name === name && a.ns !== null)

/** Privileged permissions declared by a manifest (framework-res). */
export function privilegedPermissions(manifest: Buffer): Set<string> {
  const out = new Set<string>()
  for (const e of parseAxml(manifest)) {
    if (e.name !== 'permission' || e.depth !== 1) continue
    const name = attr(e.attrs, ATTR_NAME, 'name')?.raw
    const level = attr(e.attrs, ATTR_PROTECTION_LEVEL, 'protectionLevel')
    if (name && level && level.data & PROTECTION_FLAG_PRIVILEGED) out.add(name)
  }
  return out
}

/** Package name and requested permissions (respecting maxSdkVersion). */
export function requestedPermissions(
  manifest: Buffer,
  sdk: number
): { packageName: string | null; permissions: string[] } {
  const els = parseAxml(manifest)
  const m = els.find((e) => e.name === 'manifest' && e.depth === 0)
  const packageName = m?.attrs.find((a) => a.name === 'package' && !a.ns)?.raw ?? null
  const permissions: string[] = []
  for (const e of els) {
    if (e.depth !== 1 || (e.name !== 'uses-permission' && e.name !== 'uses-permission-sdk-23'))
      continue
    const name = attr(e.attrs, ATTR_NAME, 'name')?.raw
    const max = attr(e.attrs, ATTR_MAX_SDK, 'maxSdkVersion')
    if (!name) continue
    if (max && max.data < sdk) continue
    permissions.push(name)
  }
  return { packageName, permissions }
}

/** <privapp-permissions> blocks of a permissions XML: package -> listed permission names. */
export function parsePrivappXml(xml: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const text = xml.replace(/<!--[\s\S]*?-->/g, '')
  for (const b of text.matchAll(
    /<privapp-permissions\s+package\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/privapp-permissions>/g
  )) {
    const set = out.get(b[1]) ?? new Set<string>()
    for (const p of b[2].matchAll(/<(?:deny-)?permission\s+name\s*=\s*"([^"]+)"/g)) set.add(p[1])
    out.set(b[1], set)
  }
  return out
}

async function manifestOf(apk: string): Promise<Buffer | null> {
  try {
    const z = await ZipFile.open(apk)
    try {
      return await z.read('AndroidManifest.xml', 32 * 1024 * 1024)
    } finally {
      await z.close()
    }
  } catch {
    return null
  }
}

async function propValues(root: string, files: string[], key: string): Promise<string[]> {
  const out: string[] = []
  for (const f of files) {
    if (!existsSync(join(root, f))) continue
    for (const line of (await readFile(join(root, f), 'utf8')).split('\n')) {
      const t = line.trim()
      if (t.startsWith(`${key}=`)) out.push(t.slice(key.length + 1))
    }
  }
  return out
}

/** Check every privileged app of the tree against the allowlists; null without framework-res. */
export async function checkPrivapp(
  root: string,
  partitions: string[]
): Promise<PrivappReport | null> {
  const view = await RuntimeView.open(root, partitions)
  const fwPath = join(root, 'system/system/framework/framework-res.apk')
  if (!existsSync(fwPath)) return null
  const fw = await manifestOf(fwPath)
  if (!fw) throw new Error('framework-res.apk is unreadable')
  const privileged = privilegedPermissions(fw)
  const sdk = Number(
    (await propValues(root, ['system/system/build.prop'], 'ro.build.version.sdk'))[0] ?? 0
  )
  // Every build.prop init loads. Which duplicate wins depends on init's load order, so any
  // enforce counts.
  const modes = await propValues(
    root,
    [
      'system/system/build.prop',
      'system_ext/etc/build.prop',
      'vendor/build.prop',
      'odm/etc/build.prop',
      'product/etc/build.prop',
      'mi_ext/etc/build.prop'
    ],
    'ro.control_privapp_permissions'
  )

  const violations: PrivappViolation[] = []
  let appsChecked = 0
  for (const scope of Object.keys(SCOPES) as Scope[]) {
    const allow = new Map<string, Set<string>>()
    for (const dev of SCOPES[scope].config) {
      for (const [name, e] of await view.list(dev)) {
        if (e.dir || !name.endsWith('.xml')) continue
        for (const [pkg, perms] of parsePrivappXml(await readFile(join(root, e.tree), 'utf8'))) {
          const s = allow.get(pkg) ?? new Set<string>()
          for (const p of perms) s.add(p)
          allow.set(pkg, s)
        }
      }
    }
    for (const dev of SCOPES[scope].apps) {
      for (const [name, e] of await view.list(dev)) {
        const apk = e.dir ? `${e.tree}/${name}.apk` : name.endsWith('.apk') ? e.tree : null
        if (!apk || !existsSync(join(root, apk))) continue
        const mf = await manifestOf(join(root, apk))
        if (!mf) continue
        const { packageName, permissions } = requestedPermissions(mf, sdk)
        if (!packageName || packageName === 'android') continue
        appsChecked++
        const listed = allow.get(packageName)
        for (const p of permissions) {
          if (privileged.has(p) && !listed?.has(p))
            violations.push({ scope, packageName, apk, permission: p })
        }
      }
    }
  }
  return {
    modes,
    enforced: modes.some((m) => m.toLowerCase() === 'enforce'),
    privilegedPermissions: privileged.size,
    appsChecked,
    violations
  }
}
