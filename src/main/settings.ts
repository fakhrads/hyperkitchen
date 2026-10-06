import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { Material, Settings } from '../shared/types'

const MaterialSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['gapps', 'reference-rom', 'image']),
  path: z.string().min(1),
  label: z.string(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  meta: z.record(z.string(), z.string()).optional(),
  addedAt: z.string()
})

const SettingsSchema = z.object({
  schema: z.literal(1),
  projectsRoot: z.string().min(1),
  javaPath: z.string(),
  recentProjects: z.array(z.string()),
  materials: z.array(MaterialSchema).default([])
})

export type { Material }

export const SettingsPatchSchema = z
  .object({
    projectsRoot: z.string().min(1).refine(isAbsolute, 'must be an absolute path'),
    javaPath: z
      .string()
      .refine((p) => p === '' || isAbsolute(p), 'must be empty or an absolute path')
  })
  .partial()
  .strict()

export class SettingsStore {
  private cache: Settings | null = null

  constructor(
    private readonly file: string,
    private readonly defaults: () => Settings
  ) {}

  async get(): Promise<Settings> {
    if (this.cache) return this.cache
    try {
      const parsed = SettingsSchema.safeParse(JSON.parse(await readFile(this.file, 'utf8')))
      this.cache = parsed.success ? parsed.data : this.defaults()
    } catch {
      this.cache = this.defaults()
    }
    return this.cache
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = SettingsSchema.parse({ ...(await this.get()), ...patch })
    await mkdir(dirname(this.file), { recursive: true })
    // Write then rename so a crash never leaves a half-written settings file.
    const tmp = this.file + '.tmp'
    await writeFile(tmp, JSON.stringify(next, null, 2))
    await rename(tmp, this.file)
    this.cache = next
    return next
  }
}
