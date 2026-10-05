import { existsSync } from 'node:fs'
import { lstat, readdir, readFile, readlink, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { BuildInfo, DirEntry, Inventory, StockInfo } from '../shared/types'
import { openProject } from './projects'
import { assertInside } from './safety'

/** Read stock/stock.json of a project, or null before the first unpack. */
export async function readStock(projectPath: string): Promise<StockInfo | null> {
  const p = await openProject(projectPath)
  try {
    return JSON.parse(await readFile(join(p.path, 'stock', 'stock.json'), 'utf8')) as StockInfo
  } catch {
    return null
  }
}

export async function readInventory(projectPath: string): Promise<Inventory | null> {
  const p = await openProject(projectPath)
  try {
    return JSON.parse(await readFile(join(p.path, 'stock', 'inventory.json'), 'utf8')) as Inventory
  } catch {
    return null
  }
}

/** List one directory of the extracted trees (stock/fs). Never follows symlinks. */
export async function listStockDir(projectPath: string, rel: string): Promise<DirEntry[]> {
  const p = await openProject(projectPath)
  const base = join(p.path, 'stock', 'fs')
  const dir = assertInside(base, join(base, rel))
  const out: DirEntry[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isSymbolicLink()) {
      out.push({ name: e.name, type: 'symlink', size: 0, target: await readlink(full) })
    } else if (e.isDirectory()) {
      out.push({ name: e.name, type: 'dir', size: 0 })
    } else if (e.isFile()) {
      out.push({ name: e.name, type: 'file', size: (await lstat(full)).size })
    } else {
      out.push({ name: e.name, type: 'other', size: 0 })
    }
  }
  return out.sort((a, b) =>
    a.type === 'dir' && b.type !== 'dir'
      ? -1
      : b.type === 'dir' && a.type !== 'dir'
        ? 1
        : a.name.localeCompare(b.name)
  )
}

export const UnpackParamsSchema = z.object({
  projectPath: z.string().min(1),
  input: z.string().min(1),
  reset: z.boolean().default(false)
})

/** Validate unpack params in main before anything reaches the worker. */
export async function checkUnpackParams(
  raw: Record<string, unknown>
): Promise<z.infer<typeof UnpackParamsSchema>> {
  const params = UnpackParamsSchema.parse(raw)
  const project = await openProject(params.projectPath)
  const input = resolve(params.input)
  if (!existsSync(input)) throw new Error(`input not found: ${input}`)
  const st = await stat(input)
  if (!st.isFile() && !st.isDirectory()) throw new Error(`input is not a file or folder: ${input}`)
  if (input === project.path || input.startsWith(project.path + '/')) {
    throw new Error('the input must be outside the project folder')
  }
  return { ...params, projectPath: project.path, input }
}

/** Builds of a project, newest first (build/<id>/build.json). */
export async function listBuilds(projectPath: string): Promise<BuildInfo[]> {
  const p = await openProject(projectPath)
  const dir = join(p.path, 'build')
  const out: BuildInfo[] = []
  let ids: string[] = []
  try {
    ids = await readdir(dir)
  } catch {
    return out
  }
  for (const id of ids) {
    try {
      out.push(JSON.parse(await readFile(join(dir, id, 'build.json'), 'utf8')) as BuildInfo)
    } catch {
      /* in progress or not a build */
    }
  }
  return out.sort((a, b) => b.id.localeCompare(a.id))
}

/** Absolute folder of one build, validated to be inside the project's build/ dir. */
export async function buildDir(projectPath: string, id: string): Promise<string> {
  const p = await openProject(projectPath)
  if (!/^[0-9]{8}-[0-9]{6}$/.test(id)) throw new Error(`bad build id ${id}`)
  return assertInside(join(p.path, 'build'), join(p.path, 'build', id))
}

export const BuildParamsSchema = z.object({
  projectPath: z.string().min(1),
  verity: z.enum(['fstab', 'vbmeta-flags']).default('fstab'),
  verify: z.boolean().default(true)
})

export async function checkBuildParams(
  raw: Record<string, unknown>,
  generator: string
): Promise<z.infer<typeof BuildParamsSchema> & { generator: string }> {
  const params = BuildParamsSchema.parse(raw)
  const project = await openProject(params.projectPath)
  if (!(await readStock(project.path))) throw new Error('unpack a stock ROM first')
  return { ...params, projectPath: project.path, generator }
}
