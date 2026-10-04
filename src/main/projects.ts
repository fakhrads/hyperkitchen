import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { PROJECT_SUBDIRS, type ProjectMeta, type ProjectSummary } from '../shared/types'
import { assertInside, validateProjectName } from './safety'

const ProjectMetaSchema = z.object({
  schema: z.literal(1),
  name: z.string(),
  createdAt: z.string(),
  device: z.string().nullable(),
  romVersion: z.string().nullable(),
  source: z.object({ path: z.string(), sha256: z.string().nullable() }).nullable()
})

export const PROJECT_FILE = 'project.json'
export const RECIPE_FILE = 'recipe.json'

/** Create an empty project folder. Fails if the folder already exists. */
export async function createProject(
  projectsRoot: string,
  rawName: string
): Promise<ProjectSummary> {
  const name = validateProjectName(rawName)
  const dir = assertInside(projectsRoot, join(projectsRoot, name))
  if (existsSync(dir)) throw new Error(`a folder named "${name}" already exists in ${projectsRoot}`)
  await mkdir(dir, { recursive: true })
  for (const sub of PROJECT_SUBDIRS) await mkdir(join(dir, sub))
  const meta: ProjectMeta = {
    schema: 1,
    name,
    createdAt: new Date().toISOString(),
    device: null,
    romVersion: null,
    source: null
  }
  await writeFile(join(dir, PROJECT_FILE), JSON.stringify(meta, null, 2))
  await writeFile(join(dir, RECIPE_FILE), JSON.stringify({ schema: 1, operations: [] }, null, 2))
  return { path: dir, meta }
}

export async function openProject(path: string): Promise<ProjectSummary> {
  const dir = resolve(path)
  const raw = await readFile(join(dir, PROJECT_FILE), 'utf8').catch(() => {
    throw new Error(`${dir} is not a HyperKitchen project (no ${PROJECT_FILE})`)
  })
  const meta = ProjectMetaSchema.parse(JSON.parse(raw))
  return { path: dir, meta }
}

/** Open every path, silently dropping ones that vanished or are invalid. */
export async function listProjects(paths: string[]): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = []
  for (const p of paths) {
    try {
      out.push(await openProject(p))
    } catch {
      /* stale entry */
    }
  }
  return out
}
