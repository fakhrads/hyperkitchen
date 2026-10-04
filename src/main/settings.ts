import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { z } from 'zod'
import type { Settings } from '../shared/types'

const SettingsSchema = z.object({
  schema: z.literal(1),
  projectsRoot: z.string().min(1),
  javaPath: z.string(),
  recentProjects: z.array(z.string())
})

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
