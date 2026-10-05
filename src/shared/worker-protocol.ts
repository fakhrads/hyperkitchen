import type { JobKind } from './types'

/** Everything a worker job needs to know about the host. Sent with every job so
 * settings changes apply to the next job without restarting the worker. */
export interface WorkerEnv {
  platform: string
  arch: string
  binDir: string | null
  commonBinDir: string
  manifestPath: string
  userData: string
  managedJreDir: string
  projectsRoot: string
  javaPathSetting: string
  /** Recovery update-binary for packages; absent in tests that do not build packages. */
  updaterPath?: string
}

export type MainToWorker =
  | { type: 'start'; jobId: string; kind: JobKind; params: Record<string, unknown>; env: WorkerEnv }
  | { type: 'cancel'; jobId: string }

export type WorkerToMain =
  | { type: 'progress'; jobId: string; progress: number | null; step: string }
  | { type: 'log'; jobId: string; stream: 'info' | 'stdout' | 'stderr'; text: string }
  | { type: 'done'; jobId: string; result: unknown }
  | { type: 'failed'; jobId: string; error: string }
  | { type: 'cancelled'; jobId: string }
