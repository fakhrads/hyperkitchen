import type { OperationReport, Recipe } from './recipe'

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

/** A reusable build ingredient on this machine, referenced by path (never copied into the repo). */
export interface Material {
  id: string
  kind: 'gapps' | 'reference-rom' | 'image' | 'app'
  path: string
  label: string
  /** sha256 of the file (gapps, image); absent for a reference-rom folder. */
  sha256?: string
  /** Extra facts for the picker: gapps version/arch, reference-rom romVersion, image size. */
  meta?: Record<string, string>
  addedAt: string
}

export interface Settings {
  schema: 1
  projectsRoot: string
  /** Explicit java executable. Empty string means auto-detect. */
  javaPath: string
  recentProjects: string[]
  /** Reusable materials (GApps zips, reference ROMs, images) registered once. */
  materials: Material[]
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

// ---------------------------------------------------------------- unpack (M2)

export type InputKind = 'fastboot-tgz' | 'images-zip' | 'ota-zip' | 'payload' | 'folder' | 'image'

export type ImageKind =
  'sparse' | 'super' | 'erofs' | 'ext4' | 'boot' | 'vendor_boot' | 'vbmeta' | 'empty' | 'unknown'

export interface SuperLayout {
  /** Device-mapper metadata, as read from slot 0 of the stock super image. */
  metadataMaxSize: number
  metadataSlotCount: number
  logicalBlockSize: number
  version: string
  virtualAb: boolean
  blockDevices: Array<{
    name: string
    size: number
    alignment: number
    /** Absent in stock.json files written before M3; treat as 0. */
    alignmentOffset?: number
    firstLogicalSector: number
  }>
  groups: Array<{ name: string; maximumSize: number }>
  partitions: Array<{ name: string; group: string; attributes: number; size: number }>
}

export interface PartitionInfo {
  /** Name used for the image file and the extracted tree, without slot suffix. */
  name: string
  /** Name inside super, with slot suffix; null for partitions not in super. */
  lpName: string | null
  size: number
  kind: ImageKind
  extracted: boolean
  note: string | null
}

export interface PropFile {
  partition: string
  /** Path relative to the partition root. */
  path: string
  props: Record<string, string>
}

export interface StockInfo {
  schema: 1
  unpackedAt: string
  input: { path: string; kind: InputKind; sha256: string | null }
  device: string | null
  romVersion: string | null
  super: SuperLayout | null
  partitions: PartitionInfo[]
  props: PropFile[]
  /** Files kept beside the partitions for the flashable output (firmware, scripts). */
  firmware: string[]
}

export interface ApkInfo {
  partition: string
  /** Path relative to the partition root, e.g. priv-app/Settings/Settings.apk. */
  path: string
  size: number
  packageName: string | null
  versionCode: number | null
  versionName: string | null
  sharedUserId: string | null
  usesLibraries: string[]
  overlayTarget: string | null
  signerSha256: string | null
  schemes: string[]
  error: string | null
}

export interface Inventory {
  schema: 1
  apks: ApkInfo[]
}

// ---------------------------------------------------------------- build (M3)

/**
 * How the build keeps the device from rejecting rebuilt partitions (their AVB hashtree no
 * longer matches):
 * - fstab: remove avb flags from the vendor_boot first-stage fstab (what PureCN ships for onyx)
 * - vbmeta-flags: set HASHTREE_DISABLED | VERIFICATION_DISABLED in vbmeta.img
 * Both only boot with an unlocked bootloader.
 */
export type VerityMode = 'fstab' | 'vbmeta-flags'

export interface BuildPartition {
  name: string
  lpName: string
  size: number
  sha256: string
  /** Rebuilt with mkfs.erofs from work/; false means the stock image was reused as is. */
  rebuilt: boolean
  /** Extracted again and compared file by file with the tree it was built from. */
  treeVerified: boolean
}

export interface BuildInfo {
  schema: 1
  id: string
  status: 'done' | 'failed' | 'cancelled'
  error: string | null
  startedAt: string
  finishedAt: string
  device: string | null
  romVersion: string | null
  stockInput: { path: string; sha256: string | null }
  verity: VerityMode
  verityChanges: string[]
  recipeOperations: number
  /** The exact recipe this build used, for reproducibility. */
  recipe?: Recipe
  /** What each enabled recipe operation changed. */
  operations: OperationReport[]
  /** Whether a dirty flash (keep data) is safe, or a data format is needed. */
  dataFormat: { level: 'not-needed' | 'first-install' | 'required'; reasons: string[] }
  /** Privileged permission allowlist check of the built trees. */
  privapp?: { enforced: boolean; appsChecked: number; violations: string[] }
  partitions: BuildPartition[]
  /** Super image read back and checked against the stock layout and the built images. */
  superVerified: boolean
  scripts: string[]
  /** META-INF update-binary and hk-install.json present (TWRP/OrangeFox install). */
  recoveryInstaller?: boolean
  bundledFastboot?: boolean
  /** File name of the package zip inside the build folder, when one was made. */
  zip?: string | null
  warnings: string[]
}

export interface DirEntry {
  name: string
  type: 'dir' | 'file' | 'symlink' | 'other'
  size: number
  /** Symlink target, when type is symlink. */
  target?: string
}

// ---------------------------------------------------------------- jobs

export type JobKind =
  | 'selftest'
  | 'doctor'
  | 'java-install'
  | 'clear-quarantine'
  | 'unpack'
  | 'build'
  | 'mod-create'
  | 'mod-open'
  | 'mod-save'
  | 'mod-search'
  | 'mod-export'
  | 'mod-adb'

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
  /** native: runs on the host; jar: runs with Java; payload: copied into ROM packages only. */
  kind: 'native' | 'jar' | 'payload'
  version: string
  license: string
  project: string
  neededFor: string
  /** Absent for payloads, which are never run on the host. */
  probe?: { args: string[]; match: string }
  /** Payload files that must keep the executable bit (fastboot for macOS/Linux). */
  executable?: boolean
  artifacts: Partial<Record<PlatformKey | 'common', ManifestArtifact>>
}

export interface BinManifest {
  schema: 1
  tools: ManifestTool[]
}
