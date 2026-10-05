import type { JobKind } from '../shared/types'
import { type JobHandler, sleep } from './context'
import { clearQuarantine, runDoctor } from './doctor'
import { installManagedJre } from './java'
import { run } from './spawn'
import { unpack } from './unpack'

/**
 * Self-test: exercises progress, logging, a real child process and cancel.
 * Used by the smoke test and handy for checking the IPC plumbing by hand.
 */
const selftest: JobHandler = async (ctx, params) => {
  const steps = Number(params.steps ?? 10)
  const delay = Number(params.delayMs ?? 200)
  const r = await run(process.execPath, ['-e', 'console.log("child ok")'], {
    signal: ctx.signal,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    onLine: (l, s) => ctx.log(l, s)
  })
  if (r.code !== 0) throw new Error(`child exited ${r.code}`)
  for (let i = 1; i <= steps; i++) {
    await sleep(delay, ctx.signal)
    ctx.progress(i / steps, `step ${i}/${steps}`)
  }
  return { steps }
}

export const handlers: Record<JobKind, JobHandler> = {
  selftest,
  doctor: (ctx) => runDoctor(ctx),
  'java-install': (ctx) => installManagedJre(ctx),
  'clear-quarantine': (ctx) => clearQuarantine(ctx),
  // Params are validated in main (UnpackParamsSchema) before the job starts.
  unpack: (ctx, params) =>
    unpack(ctx, {
      projectPath: String(params.projectPath),
      input: String(params.input),
      reset: params.reset === true
    })
}
