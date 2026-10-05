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

import type { Recipe } from './recipe'

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
  buildsReveal: 'builds:reveal',
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
  }
  builds: {
    list(projectPath: string): Promise<BuildInfo[]>
    /** Show the build folder in the system file manager. */
    reveal(projectPath: string, id: string): Promise<void>
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
