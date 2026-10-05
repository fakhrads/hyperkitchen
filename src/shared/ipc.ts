import type {
  AppInfo,
  BuildInfo,
  DirEntry,
  DoctorReport,
  Inventory,
  JobKind,
  JobLogLine,
  JobState,
  ProjectSummary,
  Settings,
  StockInfo
} from './types'

import type { ModSummary } from './appmod'
import type { Recipe } from './recipe'

export interface ModFile {
  /** null when the file is binary or too large to edit as text. */
  text: string | null
  size: number
  /** The stock decode's version, for diffs (null when the file was added). */
  baseText: string | null
}

export interface SmaliMethodInfo {
  sig: string
  modifiers: string[]
  returnType: string
  line: number
}

export interface GappsZipInfo {
  path: string
  sha256: string
  version: string | null
  arch: string | null
  units: Array<{ name: string; tree: string; bytes: number }>
}

export interface MediaFileInfo {
  path: string
  sha256: string
  size: number
  image: { type: 'png' | 'jpeg' | 'webp'; width: number; height: number } | null
  bootanimation: {
    desc: { width: number; height: number; fps: number; parts: unknown[] } | null
    frames: number
    compressedEntries: number
    problems: string[]
    warnings: string[]
  } | null
}

export type StubValue = 'void' | 0 | 1 | 'null'

export interface StringResInfo {
  name: string
  raw: string
  value: string
  attrs: string
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface PatchSetInfo {
  id: string
  title: string
  description: string
  targets: string[]
}

/** Channel names. One place so main and preload cannot drift apart. */
export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  dialogPickDir: 'dialog:pick-dir',
  dialogPickFile: 'dialog:pick-file',
  dialogSaveFile: 'dialog:save-file',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsOpen: 'projects:open',
  projectsForget: 'projects:forget',
  stockInfo: 'stock:info',
  stockInventory: 'stock:inventory',
  stockListDir: 'stock:list-dir',
  buildsList: 'builds:list',
  recipeGet: 'recipe:get',
  recipeSave: 'recipe:save',
  recipeCatalog: 'recipe:catalog',
  recipeExport: 'recipe:export',
  recipeImport: 'recipe:import',
  buildsReveal: 'builds:reveal',
  gappsInspect: 'gapps:inspect',
  mediaInspect: 'media:inspect',
  modsList: 'mods:list',
  modsListDir: 'mods:list-dir',
  modsRead: 'mods:read',
  modsWrite: 'mods:write',
  modsRevert: 'mods:revert',
  modsDelete: 'mods:delete',
  modsMethods: 'mods:methods',
  modsStub: 'mods:stub',
  modsStringLocales: 'mods:string-locales',
  modsStrings: 'mods:strings',
  modsSetString: 'mods:set-string',
  modsReveal: 'mods:reveal',
  jobsList: 'jobs:list',
  jobsStart: 'jobs:start',
  jobsCancel: 'jobs:cancel',
  jobsLog: 'jobs:log',
  doctorLast: 'doctor:last',
  // main -> renderer events
  evJobUpdate: 'ev:job-update',
  evJobLog: 'ev:job-log'
} as const

/** The API exposed on window.hk by the preload script. */
export interface HkApi {
  appInfo(): Promise<AppInfo>
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Pick<Settings, 'projectsRoot' | 'javaPath'>>): Promise<Settings>
  }
  dialog: {
    pickDir(title: string): Promise<string | null>
    /** extensions without dots, e.g. ['tgz', 'zip']. */
    pickFile(title: string, extensions: string[]): Promise<string | null>
    /** Ask where to save a file; returns the chosen path or null. */
    saveFile(title: string, defaultName: string, extensions: string[]): Promise<string | null>
  }
  projects: {
    list(): Promise<ProjectSummary[]>
    create(name: string): Promise<ProjectSummary>
    open(path: string): Promise<ProjectSummary>
    forget(path: string): Promise<void>
  }
  stock: {
    info(projectPath: string): Promise<StockInfo | null>
    inventory(projectPath: string): Promise<Inventory | null>
    /** rel is relative to stock/fs, e.g. "system/system/priv-app". */
    listDir(projectPath: string, rel: string): Promise<DirEntry[]>
  }
  recipe: {
    get(projectPath: string): Promise<Recipe>
    save(projectPath: string, recipe: Recipe): Promise<Recipe>
    /** Available smali patch sets. */
    catalog(): Promise<PatchSetInfo[]>
    /** Read a MindTheGapps zip: SDK level, arch, apps and sha256. */
    inspectGapps(zipPath: string): Promise<GappsZipInfo>
    /** Write the project recipe to a file the user chooses. */
    export(projectPath: string, destPath: string): Promise<void>
    /** Replace the project recipe with one read from a file; returns it validated. */
    import(projectPath: string, srcPath: string): Promise<Recipe>
    /** Read an image or bootanimation.zip chosen for the media operation. */
    inspectMedia(projectPath: string, filePath: string): Promise<MediaFileInfo>
  }
  builds: {
    list(projectPath: string): Promise<BuildInfo[]>
    /** Show the build folder in the system file manager. */
    reveal(projectPath: string, id: string): Promise<void>
  }
  mods: {
    list(projectPath: string): Promise<ModSummary[]>
    /** rel is relative to the mod's working copy; '' is its root. */
    listDir(projectPath: string, id: string, rel: string): Promise<DirEntry[]>
    read(projectPath: string, id: string, rel: string): Promise<ModFile>
    write(projectPath: string, id: string, rel: string, text: string): Promise<void>
    /** Back to the stock decode's content (an added file is deleted). */
    revert(projectPath: string, id: string, rel: string): Promise<void>
    remove(projectPath: string, id: string, rel: string): Promise<void>
    methods(projectPath: string, id: string, rel: string): Promise<SmaliMethodInfo[]>
    stub(projectPath: string, id: string, rel: string, sig: string, value: StubValue): Promise<void>
    stringLocales(projectPath: string, id: string): Promise<string[]>
    strings(projectPath: string, id: string, values: string): Promise<StringResInfo[]>
    /** value null removes the string. */
    setString(
      projectPath: string,
      id: string,
      values: string,
      name: string,
      value: string | null
    ): Promise<StringResInfo[]>
    /** Show mods/<id>/out (ROM-ready APK) or mods/<id>/adb-package. */
    reveal(projectPath: string, id: string, which: 'out' | 'adb-package'): Promise<void>
  }
  jobs: {
    list(): Promise<JobState[]>
    start(kind: JobKind, params?: Record<string, unknown>): Promise<string>
    cancel(id: string): Promise<void>
    log(id: string): Promise<JobLogLine[]>
    onUpdate(cb: (job: JobState) => void): () => void
    onLog(cb: (line: JobLogLine) => void): () => void
  }
  doctor: {
    last(): Promise<DoctorReport | null>
  }
}
