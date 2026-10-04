// Types shared by main, worker, preload and renderer. Keep this file free of
// Node or Electron imports so the renderer bundle can include it.

export type PlatformKey = 'darwin-arm64' | 'darwin-x64' | 'linux-x64'

export const SUPPORTED_PLATFORMS: readonly PlatformKey[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64'
]

export interface AppInfo {
  version: string
  electron: string
  node: string
  platform: string
  arch: string
  platformKey: PlatformKey | null
  userData: string
  binDir: string | null
  commonBinDir: string
  packaged: boolean
}

export interface Settings {
  schema: 1
  projectsRoot: string
  /** Explicit java executable. Empty string means auto-detect. */
  javaPath: string
  recentProjects: string[]
}

// ---------------------------------------------------------------- projects

export interface ProjectMeta {
  schema: 1
  name: string
  createdAt: string
  /** Filled in by the unpack step (M2). */
  device: string | null
  romVersion: string | null
  source: { path: string; sha256: string | null } | null
}

export interface ProjectSummary {
  path: string
  meta: ProjectMeta
}

export const PROJECT_SUBDIRS = ['source', 'stock', 'work', 'build', 'logs'] as const

// ---------------------------------------------------------------- jobs

export type JobKind = 'selftest' | 'doctor' | 'java-install' | 'clear-quarantine'

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface JobState {
  id: string
  kind: JobKind
  title: string
  status: JobStatus
  /** 0..1, or null when the job cannot estimate progress. */
  progress: number | null
  step: string
  startedAt: number
  endedAt: number | null
  error: string | null
  result: unknown
}

export interface JobLogLine {
  jobId: string
  ts: number
  stream: 'info' | 'stdout' | 'stderr'
  text: string
}

// ---------------------------------------------------------------- doctor

export type CheckStatus = 'ok' | 'warn' | 'error'

export interface DoctorCheck {
  id: string
  group: 'binaries' | 'java' | 'host'
  label: string
  status: CheckStatus
  detail: string
  version?: string
  /** Milestone that first needs this item, shown so missing items are easy to triage. */
  neededFor?: string
}

export interface DoctorReport {
  generatedAt: string
  platformKey: PlatformKey | null
  checks: DoctorCheck[]
  java: JavaInfo | null
}

export interface JavaInfo {
  path: string
  version: string
  major: number
  source: 'settings' | 'managed' | 'JAVA_HOME' | 'PATH'
}

// ---------------------------------------------------------------- binaries manifest

export interface ManifestArtifact {
  url: string
  sha256: string
  /** How the download is packaged. 'raw' means the URL is the file itself. */
  archive: 'raw' | 'zip' | 'tar.gz'
  /** Path of the file inside the archive. Ignored for 'raw'. */
  member?: string
}

export interface ManifestTool {
  id: string
  /** File name on disk inside the platform (or common) bin dir. */
  file: string
  kind: 'native' | 'jar'
  version: string
  license: string
  project: string
  neededFor: string
  probe: { args: string[]; match: string }
  artifacts: Partial<Record<PlatformKey | 'common', ManifestArtifact>>
}

export interface BinManifest {
  schema: 1
  tools: ManifestTool[]
}
