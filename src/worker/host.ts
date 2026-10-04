import type { MainToWorker, WorkerToMain } from '../shared/worker-protocol'
import { CancelledError, type JobContext } from './context'
import { handlers } from './jobs'

/**
 * Transport-agnostic job host. The utility process entry wires it to
 * process.parentPort; tests wire it to a plain function.
 */
export function createHost(send: (msg: WorkerToMain) => void): (msg: MainToWorker) => void {
  const running = new Map<string, AbortController>()

  return (msg) => {
    if (msg.type === 'cancel') {
      running.get(msg.jobId)?.abort()
      return
    }
    const { jobId, kind, params, env } = msg
    const handler = handlers[kind]
    if (!handler) {
      send({ type: 'failed', jobId, error: `unknown job kind: ${kind}` })
      return
    }
    const ac = new AbortController()
    running.set(jobId, ac)
    let lastProgressAt = 0
    const ctx: JobContext = {
      jobId,
      env,
      signal: ac.signal,
      progress: (progress, step = '') => {
        // Throttle to ~10 updates/s; always pass the final 100%.
        const now = Date.now()
        if (progress !== 1 && now - lastProgressAt < 100) return
        lastProgressAt = now
        send({ type: 'progress', jobId, progress, step })
      },
      log: (text, stream = 'info') => send({ type: 'log', jobId, stream, text })
    }
    handler(ctx, params)
      .then((result) => send({ type: 'done', jobId, result }))
      .catch((e: unknown) => {
        if (e instanceof CancelledError || ac.signal.aborted) send({ type: 'cancelled', jobId })
        else send({ type: 'failed', jobId, error: e instanceof Error ? e.message : String(e) })
      })
      .finally(() => running.delete(jobId))
  }
}
