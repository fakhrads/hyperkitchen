// work/fs with its per-partition fs_config and file_contexts kept in sync with the files.
// Every recipe operation goes through this class, so rebuilt images always carry metadata for
// exactly the files they contain (the build's verification gate checks that).
//
// Formats, as written by extract.erofs:
//   fs_config:      "<partition>/<path> <uid> <gid> <mode>[ capabilities=0x..]"
//   file_contexts:  "/<partition>/<path with regex metacharacters escaped> <label>"

import { existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { assertInside } from '../../main/safety'

const REGEX_META = /[.*+?^${}()|[\]\\]/g
export const escapeContextPath = (p: string): string => p.replace(REGEX_META, '\\$&')
export const unescapeContextPath = (p: string): string => p.replace(/\\(.)/g, '$1')

/** One config line, kept verbatim so untouched entries round-trip byte for byte. */
interface Entry {
  /** Literal path without leading or trailing slash, e.g. "product/app/Foo" ("" = image root). */
  key: string
  line: string
}

interface PartitionConfig {
  fs: Entry[]
  ctx: Entry[]
}

const norm = (p: string): string => p.replace(/^\/+|\/+$/g, '')

export interface FileMeta {
  uid?: number
  gid?: number
  mode?: number
  /** SELinux label; defaults to the nearest ancestor's label. */
  label?: string
  /** Exact fs_config fields after the path ("uid gid mode [capabilities=..]"); wins over uid/gid/mode. */
  fsRest?: string
}

export interface EntryMeta {
  fsRest: string
  label: string
}

export class WorkTree {
  private readonly configs = new Map<string, PartitionConfig>()
  readonly added = new Set<string>()
  readonly removed = new Set<string>()
  readonly modified = new Set<string>()

  private constructor(
    readonly root: string,
    readonly partitions: string[]
  ) {}

  /** root is work/fs; partitions are the extracted trees that have config files. */
  static async open(root: string, partitions: string[]): Promise<WorkTree> {
    const t = new WorkTree(root, partitions)
    for (const p of partitions) {
      const cfg = join(root, 'config')
      const fsLines = (await readFile(join(cfg, `${p}_fs_config`), 'utf8'))
        .split('\n')
        .filter(Boolean)
      const ctxLines = (await readFile(join(cfg, `${p}_file_contexts`), 'utf8'))
        .split('\n')
        .filter(Boolean)
      const c: PartitionConfig = {
        fs: fsLines.map((line) => ({ key: norm(line.slice(0, line.indexOf(' '))), line })),
        ctx: ctxLines.map((line) => ({
          key: norm(unescapeContextPath(line.slice(0, line.lastIndexOf(' ')))),
          line
        }))
      }
      t.configs.set(p, c)
    }
    return t
  }

  partitionOf(rel: string): string {
    const p = rel.split('/')[0]
    if (!this.configs.has(p)) throw new Error(`${rel}: not inside an extracted partition`)
    return p
  }

  abs(rel: string): string {
    this.partitionOf(rel)
    return assertInside(this.root, join(this.root, rel))
  }

  exists(rel: string): boolean {
    return existsSync(this.abs(rel))
  }

  async read(rel: string): Promise<Buffer> {
    return readFile(this.abs(rel))
  }

  /** Remove a file or directory tree and every config entry under it. */
  async remove(rel: string): Promise<void> {
    const c = this.configs.get(this.partitionOf(rel)) as PartitionConfig
    const abs = this.abs(rel)
    if (!existsSync(abs)) throw new Error(`${rel}: does not exist`)
    await rm(abs, { recursive: true, force: true })
    const under = (e: Entry): boolean => e.key === rel || e.key.startsWith(rel + '/')
    c.fs = c.fs.filter((e) => !under(e))
    c.ctx = c.ctx.filter((e) => !under(e))
    this.removed.add(rel)
  }

  /** Replace the contents of an existing file; its metadata is kept. */
  async writeExisting(rel: string, data: Buffer | string): Promise<void> {
    const abs = this.abs(rel)
    if (!existsSync(abs) || !(await lstat(abs)).isFile())
      throw new Error(`${rel}: not an existing file`)
    await writeFile(abs, data)
    if (!this.added.has(rel)) this.modified.add(rel)
  }

  private labelFor(c: PartitionConfig, rel: string): string {
    for (let p = rel; ; p = posix.dirname(p)) {
      const key = p === '.' ? '' : p
      const e = c.ctx.find((x) => x.key === key)
      if (e) return e.line.slice(e.line.lastIndexOf(' ') + 1)
      if (key === '') throw new Error(`${rel}: no SELinux label to inherit`)
    }
  }

  private push(c: PartitionConfig, rel: string, owner: string, label: string): void {
    c.fs.push({ key: rel, line: `${rel} ${owner}` })
    c.ctx.push({ key: rel, line: `${escapeContextPath('/' + rel)} ${label}` })
  }

  private async ensureDir(rel: string): Promise<void> {
    const c = this.configs.get(this.partitionOf(rel)) as PartitionConfig
    const parts = rel.split('/')
    for (let i = 2; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      if (existsSync(this.abs(d))) continue
      await mkdir(this.abs(d))
      this.push(c, d, '0 0 0755', this.labelFor(c, posix.dirname(d)))
      this.added.add(d)
    }
  }

  /** Add a new file (from a buffer or a host file) with Android metadata. */
  async addFile(rel: string, data: Buffer | { from: string }, meta: FileMeta = {}): Promise<void> {
    const c = this.configs.get(this.partitionOf(rel)) as PartitionConfig
    const abs = this.abs(rel)
    if (existsSync(abs)) throw new Error(`${rel}: already exists`)
    await this.ensureDir(posix.dirname(rel))
    if (Buffer.isBuffer(data)) await writeFile(abs, data)
    else await copyFile(data.from, abs)
    const mode = (meta.mode ?? 0o644).toString(8).padStart(4, '0')
    this.push(
      c,
      rel,
      meta.fsRest ?? `${meta.uid ?? 0} ${meta.gid ?? 0} ${mode}`,
      meta.label ?? this.labelFor(c, posix.dirname(rel))
    )
    this.added.add(rel)
  }

  /** Exact metadata of an existing entry (used to copy files between trees). */
  meta(rel: string): EntryMeta | null {
    const c = this.configs.get(this.partitionOf(rel)) as PartitionConfig
    const fs = c.fs.find((e) => e.key === rel)
    const ctx = c.ctx.find((e) => e.key === rel)
    if (!fs || !ctx) return null
    return {
      fsRest: fs.line.slice(fs.line.indexOf(' ') + 1),
      label: ctx.line.slice(ctx.line.lastIndexOf(' ') + 1)
    }
  }

  /** Add a directory with exact metadata (parents are created with inherited metadata). */
  async addDir(rel: string, meta: EntryMeta): Promise<void> {
    const c = this.configs.get(this.partitionOf(rel)) as PartitionConfig
    if (this.exists(rel)) return
    await this.ensureDir(posix.dirname(rel))
    await mkdir(this.abs(rel))
    this.push(c, rel, meta.fsRest, meta.label)
    this.added.add(rel)
  }

  /** Write fs_config and file_contexts back; untouched lines are unchanged. */
  async save(): Promise<void> {
    for (const [p, c] of this.configs) {
      const cfg = join(this.root, 'config')
      await writeFile(join(cfg, `${p}_fs_config`), c.fs.map((e) => e.line).join('\n') + '\n')
      await writeFile(join(cfg, `${p}_file_contexts`), c.ctx.map((e) => e.line).join('\n') + '\n')
    }
  }
}
