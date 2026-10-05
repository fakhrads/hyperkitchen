// App editor file access for the renderer. Every path is relative to a mod's working copy
// (mods/<id>/cache/edit) and checked to stay inside it. Heavy work (decode, save, search,
// build) runs as worker jobs; this is only browsing and small text edits.

import { existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { DECODE_META, MOD_ID, type ModSummary } from '../shared/appmod'
import type { DirEntry } from '../shared/types'
import { listMods, modPaths } from '../worker/appmod/mod'
import { listMethods, stubMethod, type SmaliMethod, type StubValue } from '../worker/appmod/smali'
import { listStrings, removeString, setString, type StringRes } from '../worker/appmod/strings'
import { openProject } from './projects'
import { assertInside } from './safety'

const MAX_TEXT = 8 * 1024 * 1024

export const ModIdSchema = z.string().regex(MOD_ID)
const RelSchema = z.string()

async function editRoot(projectPath: string, id: string): Promise<{ edit: string; base: string }> {
  const p = await openProject(projectPath)
  const paths = modPaths(p.path, ModIdSchema.parse(id))
  if (!existsSync(paths.edit)) throw new Error(`mod ${id} is not open; open it first`)
  return { edit: paths.edit, base: paths.base }
}

function inEdit(root: string, rel: string): string {
  const r = RelSchema.parse(rel)
  const target = assertInside(root, join(root, r))
  const top = r.split('/')[0]
  if (DECODE_META.has(top)) throw new Error(`${r} is apktool metadata`)
  return target
}

export async function modsList(projectPath: string): Promise<ModSummary[]> {
  const p = await openProject(projectPath)
  return listMods(p.path)
}

export async function modListDir(
  projectPath: string,
  id: string,
  rel: string
): Promise<DirEntry[]> {
  const { edit } = await editRoot(projectPath, id)
  const dir = rel ? inEdit(edit, rel) : edit
  const out: DirEntry[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!rel && (DECODE_META.has(e.name) || e.name.startsWith('.'))) continue
    if (e.isDirectory()) out.push({ name: e.name, type: 'dir', size: 0 })
    else if (e.isFile())
      out.push({ name: e.name, type: 'file', size: (await lstat(join(dir, e.name))).size })
  }
  return out.sort((a, b) =>
    a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)
  )
}

export interface ModFile {
  /** null when the file is binary or too large to edit as text. */
  text: string | null
  size: number
  /** The pristine decode's version, for diffs (null when the file was added). */
  baseText: string | null
}

function asText(b: Buffer): string | null {
  if (b.length > MAX_TEXT || b.includes(0)) return null
  const s = b.toString('utf8')
  return Buffer.from(s, 'utf8').equals(b) ? s : null
}

export async function modReadFile(projectPath: string, id: string, rel: string): Promise<ModFile> {
  const { edit, base } = await editRoot(projectPath, id)
  const b = await readFile(inEdit(edit, rel))
  const bf = join(base, rel)
  return {
    text: asText(b),
    size: b.length,
    baseText: existsSync(bf) ? asText(await readFile(assertInside(base, bf))) : null
  }
}

export async function modWriteFile(
  projectPath: string,
  id: string,
  rel: string,
  text: string
): Promise<void> {
  const { edit } = await editRoot(projectPath, id)
  const f = inEdit(edit, rel)
  await mkdir(dirname(f), { recursive: true })
  await writeFile(f, z.string().max(MAX_TEXT).parse(text))
}

/** Put a file back as the stock decode has it (an added file is deleted). */
export async function modRevertFile(projectPath: string, id: string, rel: string): Promise<void> {
  const { edit, base } = await editRoot(projectPath, id)
  const f = inEdit(edit, rel)
  const b = assertInside(base, join(base, rel))
  if (existsSync(b)) {
    await mkdir(dirname(f), { recursive: true })
    await copyFile(b, f)
  } else {
    await rm(f, { force: true })
  }
}

export async function modDeleteFile(projectPath: string, id: string, rel: string): Promise<void> {
  const { edit } = await editRoot(projectPath, id)
  await rm(inEdit(edit, rel))
}

export async function modMethods(
  projectPath: string,
  id: string,
  rel: string
): Promise<SmaliMethod[]> {
  const { edit } = await editRoot(projectPath, id)
  if (!rel.endsWith('.smali')) return []
  return listMethods(await readFile(inEdit(edit, rel), 'utf8'))
}

const StubValueSchema = z.union([z.literal('void'), z.literal(0), z.literal(1), z.literal('null')])

export async function modStub(
  projectPath: string,
  id: string,
  rel: string,
  sig: unknown,
  value: unknown
): Promise<void> {
  const { edit } = await editRoot(projectPath, id)
  if (!rel.endsWith('.smali')) throw new Error('not a smali file')
  const f = inEdit(edit, rel)
  const text = await readFile(f, 'utf8')
  await writeFile(
    f,
    stubMethod(text, z.string().min(1).parse(sig), StubValueSchema.parse(value) as StubValue)
  )
}

/** values* directories that hold strings.xml, e.g. "values", "values-zh-rCN". */
export async function modStringLocales(projectPath: string, id: string): Promise<string[]> {
  const { edit } = await editRoot(projectPath, id)
  const res = join(edit, 'res')
  if (!existsSync(res)) return []
  const dirs = (await readdir(res)).filter(
    (d) => /^values(-|$)/.test(d) && existsSync(join(res, d, 'strings.xml'))
  )
  return dirs.sort((a, b) => (a === 'values' ? -1 : b === 'values' ? 1 : a.localeCompare(b)))
}

const ValuesDir = z.string().regex(/^values(-[A-Za-z0-9+_-]+)?$/)

export async function modStrings(
  projectPath: string,
  id: string,
  values: string
): Promise<StringRes[]> {
  const { edit } = await editRoot(projectPath, id)
  const f = inEdit(edit, `res/${ValuesDir.parse(values)}/strings.xml`)
  return listStrings(await readFile(f, 'utf8'))
}

export async function modSetString(
  projectPath: string,
  id: string,
  values: string,
  name: string,
  value: string | null
): Promise<StringRes[]> {
  const { edit } = await editRoot(projectPath, id)
  const f = inEdit(edit, `res/${ValuesDir.parse(values)}/strings.xml`)
  const xml = await readFile(f, 'utf8')
  const next =
    value === null
      ? removeString(xml, z.string().parse(name))
      : setString(
          xml,
          z.string().parse(name),
          z
            .string()
            .max(64 * 1024)
            .parse(value)
        )
  await writeFile(f, next)
  return listStrings(next)
}

const Project = z.string().min(1)
const Id = ModIdSchema

/** Params of the app editor jobs, validated before they reach the worker. */
export const ModJobSchemas = {
  'mod-create': z.object({
    projectPath: Project,
    target: z
      .string()
      .min(1)
      .refine((p) => !p.startsWith('/') && !p.split('/').includes('..') && /\.(apk|jar)$/.test(p)),
    resources: z.boolean().default(true)
  }),
  'mod-open': z.object({ projectPath: Project, id: Id, reset: z.boolean().default(false) }),
  'mod-save': z.object({ projectPath: Project, id: Id }),
  'mod-search': z.object({
    projectPath: Project,
    id: Id,
    query: z.string().min(1).max(500),
    regex: z.boolean().default(false),
    caseSensitive: z.boolean().default(false),
    under: z
      .string()
      .default('')
      .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'))
  }),
  'mod-export': z.object({ projectPath: Project, id: Id })
} as const

export type ModJobKind = keyof typeof ModJobSchemas

export async function checkModJob(
  kind: ModJobKind,
  params: unknown
): Promise<Record<string, unknown>> {
  const parsed = ModJobSchemas[kind].parse(params) as Record<string, unknown> & {
    projectPath: string
    id?: string
  }
  const p = await openProject(parsed.projectPath)
  parsed.projectPath = p.path
  if (parsed.id && !existsSync(modPaths(p.path, parsed.id).modFile))
    throw new Error(`no mod ${parsed.id} in this project`)
  if (kind === 'mod-search' && parsed.regex) new RegExp(String(parsed.query))
  return parsed
}
