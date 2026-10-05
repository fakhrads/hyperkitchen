// The filesystem as the running device sees it, built from the extracted trees.
//
// HyperOS stacks partitions with overlayfs mounts listed in the vendor fstab, e.g. on onyx
// (vendor/etc/fstab.qcom):
//   overlay /product/priv-app overlay ro,lowerdir=/mnt/vendor/mi_ext/product/priv-app/:/product/priv-app
//   overlay /system/etc/permissions overlay ro,lowerdir=/mnt/vendor/mi_ext/system/etc/permissions/:/product/pangu/system/etc/permissions/:/system/etc/permissions
// With several lowerdirs, the leftmost layer wins for a name present in more than one
// (overlayfs: "lowerdir=/lower1:/lower2", lower1 on top). This module reads those lines from
// the ROM itself and answers "what is in /product/priv-app" with tree paths.

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface OverlayMount {
  /** Mount point on the device, e.g. /product/priv-app. */
  target: string
  /** Layers on the device, top first. */
  lowers: string[]
}

/** Overlay lines of an fstab: `overlay <target> overlay <opts with lowerdir=a:b> <fsmgr>`. */
export function parseFstabOverlays(text: string): OverlayMount[] {
  const out: OverlayMount[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const f = line.split(/\s+/)
    if (f.length < 4 || f[2] !== 'overlay') continue
    const lower = f[3].split(',').find((o) => o.startsWith('lowerdir='))
    if (!lower) continue
    const lowers = lower
      .slice('lowerdir='.length)
      .split(':')
      .filter(Boolean)
      .map((p) => (p.startsWith('/') ? p : '/' + p).replace(/\/+$/, ''))
    out.push({ target: f[1].replace(/\/+$/, ''), lowers })
  }
  return out
}

/** Device path -> tree path (relative to the fs root), or null when not in the trees. */
export function devToTree(dev: string, partitions: string[]): string | null {
  const p = dev.replace(/\/+$/, '')
  if (p.startsWith('/mnt/vendor/')) {
    const rest = p.slice('/mnt/vendor/'.length)
    return partitions.includes(rest.split('/')[0]) ? rest : null
  }
  if (p === '/system' || p.startsWith('/system/'))
    return 'system/system' + p.slice('/system'.length)
  const top = p.split('/')[1]
  return partitions.includes(top) ? p.slice(1) : null
}

export class RuntimeView {
  private constructor(
    readonly root: string,
    readonly partitions: string[],
    readonly mounts: OverlayMount[]
  ) {}

  /** Read every overlay line of vendor/etc/fstab.* and odm/etc/fstab.* in the tree. */
  static async open(root: string, partitions: string[]): Promise<RuntimeView> {
    const mounts = new Map<string, OverlayMount>()
    for (const dir of ['vendor/etc', 'odm/etc']) {
      if (!existsSync(join(root, dir))) continue
      for (const n of (await readdir(join(root, dir))).sort()) {
        if (!n.startsWith('fstab.')) continue
        for (const m of parseFstabOverlays(await readFile(join(root, dir, n), 'utf8')))
          if (!mounts.has(m.target)) mounts.set(m.target, m)
      }
    }
    return new RuntimeView(root, partitions, [...mounts.values()])
  }

  /** Tree directories that make up a device directory, top layer first. */
  layers(dev: string): string[] {
    const m = this.mounts.find((x) => x.target === dev)
    const devs = m ? m.lowers : [dev]
    return devs
      .map((d) => devToTree(d, this.partitions))
      .filter((t): t is string => t !== null && existsSync(join(this.root, t)))
  }

  /** Entries of a device directory: name -> tree path of the visible one. */
  async list(dev: string): Promise<Map<string, { tree: string; dir: boolean }>> {
    const out = new Map<string, { tree: string; dir: boolean }>()
    for (const layer of this.layers(dev)) {
      for (const e of await readdir(join(this.root, layer), { withFileTypes: true })) {
        if (!out.has(e.name)) out.set(e.name, { tree: `${layer}/${e.name}`, dir: e.isDirectory() })
      }
    }
    return out
  }
}
