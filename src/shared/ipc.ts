import type {
  AppInfo,
  DoctorReport,
  JobKind,
  JobLogLine,
  JobState,
  ProjectSummary,
  Settings
} from './types'

/** Channel names. One place so main and preload cannot drift apart. */
export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  dialogPickDir: 'dialog:pick-dir',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsOpen: 'projects:open',
  projectsForget: 'projects:forget',
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
  }
  projects: {
    list(): Promise<ProjectSummary[]>
    create(name: string): Promise<ProjectSummary>
    open(path: string): Promise<ProjectSummary>
    forget(path: string): Promise<void>
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
