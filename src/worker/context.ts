import type { WorkerEnv } from '../shared/worker-protocol'

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export interface JobContext {
  jobId: string
  env: WorkerEnv
  signal: AbortSignal
  progress(progress: number | null, step?: string): void
  log(text: string, stream?: 'info' | 'stdout' | 'stderr'): void
}

export type JobHandler = (ctx: JobContext, params: Record<string, unknown>) => Promise<unknown>

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError()
}

/** Abortable sleep, used by the self-test job and retry loops. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CancelledError())
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new CancelledError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
