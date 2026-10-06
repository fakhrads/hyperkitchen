import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { platformKey } from '../../src/shared/platform'
import { assertInside, isInside, validateProjectName } from '../../src/main/safety'
import { createProject, listProjects, openProject } from '../../src/main/projects'
import { SettingsPatchSchema, SettingsStore } from '../../src/main/settings'
import { adoptiumQuery, parseJavaVersion } from '../../src/worker/java'

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-test-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('platformKey', () => {
  it('maps supported hosts', () => {
    expect(platformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(platformKey('darwin', 'x64')).toBe('darwin-x64')
    expect(platformKey('linux', 'x64')).toBe('linux-x64')
  })
  it('rejects unsupported hosts', () => {
    expect(platformKey('linux', 'arm64')).toBeNull()
    expect(platformKey('win32', 'x64')).toBeNull()
  })
})

describe('safety', () => {
  it('detects paths inside and outside a base', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b/c/d')).toBe(true)
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(isInside('/a/b', '/a/b/../c')).toBe(false)
    expect(isInside('/a/b', '/etc/passwd')).toBe(false)
    expect(() => assertInside('/a/b', '/a/b/../../x')).toThrow(/outside/)
  })
  it('validates project names', () => {
    expect(validateProjectName('  onyx-OS3.0_CN ')).toBe('onyx-OS3.0_CN')
    for (const bad of ['', '../evil', 'a/b', '.hidden', 'x'.repeat(65), 'trailing.', 'a\\b']) {
      expect(() => validateProjectName(bad), bad).toThrow()
    }
  })
})

describe('projects', () => {
  it('creates the folder layout and reopens it', async () => {
    const p = await createProject(tmp, 'onyx test')
    for (const f of ['project.json', 'recipe.json', 'source', 'stock', 'work', 'build', 'logs']) {
      expect(existsSync(join(p.path, f)), f).toBe(true)
    }
    const recipe = JSON.parse(await readFile(join(p.path, 'recipe.json'), 'utf8'))
    expect(recipe).toEqual({ schema: 1, operations: [] })
    const o = await openProject(p.path)
    expect(o.meta.name).toBe('onyx test')
    expect(o.meta.device).toBeNull()
  })
  it('refuses to overwrite an existing folder', async () => {
    await createProject(tmp, 'dup')
    await expect(createProject(tmp, 'dup')).rejects.toThrow(/already exists/)
  })
  it('refuses traversal names', async () => {
    await expect(createProject(tmp, '../escape')).rejects.toThrow()
    expect(existsSync(join(tmp, '..', 'escape'))).toBe(false)
  })
  it('open fails on a non-project folder and list drops stale entries', async () => {
    await expect(openProject(tmp)).rejects.toThrow(/not a HyperKitchen project/)
    const p = await createProject(tmp, 'real')
    const list = await listProjects([p.path, join(tmp, 'gone')])
    expect(list.map((x) => x.meta.name)).toEqual(['real'])
  })
})

describe('settings', () => {
  const defaults = () => ({
    schema: 1 as const,
    projectsRoot: '/x',
    javaPath: '',
    recentProjects: [],
    materials: []
  })
  it('returns defaults when no file and persists updates', async () => {
    const file = join(tmp, 'settings.json')
    const s = new SettingsStore(file, defaults)
    expect((await s.get()).projectsRoot).toBe('/x')
    await s.update({ projectsRoot: '/y' })
    const s2 = new SettingsStore(file, defaults)
    expect((await s2.get()).projectsRoot).toBe('/y')
  })
  it('falls back to defaults on a corrupt file', async () => {
    const file = join(tmp, 'settings.json')
    await (await import('node:fs/promises')).writeFile(file, '{not json')
    expect((await new SettingsStore(file, defaults).get()).projectsRoot).toBe('/x')
  })
  it('patch schema rejects relative paths and unknown keys', () => {
    expect(SettingsPatchSchema.safeParse({ projectsRoot: 'rel/path' }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ javaPath: 'java' }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ javaPath: '' }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ recentProjects: [] }).success).toBe(false)
  })
})

describe('java', () => {
  it('parses java -version output', () => {
    expect(
      parseJavaVersion(
        'openjdk version "21.0.12.1" 2026-08-18 LTS\nOpenJDK Runtime Environment Temurin'
      )
    ).toEqual({ version: '21.0.12.1', major: 21 })
    expect(parseJavaVersion('java version "1.8.0_402"')).toEqual({ version: '1.8.0_402', major: 8 })
    expect(parseJavaVersion('openjdk version "17" 2021-09-14')).toEqual({
      version: '17',
      major: 17
    })
    expect(parseJavaVersion('garbage')).toBeNull()
  })
  it('builds Adoptium queries with their os/arch naming', () => {
    expect(adoptiumQuery('darwin', 'arm64')).toContain('os=mac&architecture=aarch64')
    expect(adoptiumQuery('linux', 'x64')).toContain('os=linux&architecture=x64')
    expect(adoptiumQuery('linux', 'x64')).toContain('image_type=jre')
  })
})
