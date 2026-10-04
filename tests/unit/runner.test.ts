import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobManager, type WorkerLike } from '../../src/main/jobs'
import type { JobState } from '../../src/shared/types'
import type { MainToWorker, WorkerEnv, WorkerToMain } from '../../src/shared/worker-protocol'
import { CancelledError } from '../../src/worker/context'
import { createHost } from '../../src/worker/host'
import { run } from '../../src/worker/spawn'

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-run-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const env = (): WorkerEnv => ({
  platform: process.platform,
  arch: process.arch,
  binDir: null,
  commonBinDir: tmp,
  manifestPath: join(tmp, 'none.json'),
  userData: tmp,
  managedJreDir: join(tmp, 'jre'),
  projectsRoot: join(tmp, 'projects'),
  javaPathSetting: ''
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('spawn.run', () => {
  it('streams lines from stdout and stderr and strips ANSI', async () => {
    const lines: string[] = []
    const r = await run(
      'sh',
      ['-c', 'printf "a\\nb"; printf "\\033[31mred\\033[0m\\n" 1>&2; exit 3'],
      {
        onLine: (l, s) => lines.push(`${s}:${l}`)
      }
    )
    expect(r.code).toBe(3)
    expect(lines).toContain('stdout:a')
    expect(lines).toContain('stdout:b')
    expect(lines).toContain('stderr:red')
  })

  it('cancel kills the whole process group, including grandchildren', async () => {
    const pidFile = join(tmp, 'pid')
    const ac = new AbortController()
    const p = run('sh', ['-c', `sleep 60 & echo $! > ${pidFile}; wait`], { signal: ac.signal })
    await new Promise((r) => setTimeout(r, 300))
    const grandchild = Number((await import('node:fs')).readFileSync(pidFile, 'utf8'))
    expect(alive(grandchild)).toBe(true)
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(CancelledError)
    await new Promise((r) => setTimeout(r, 300))
    expect(alive(grandchild)).toBe(false)
  })

  it('times out', async () => {
    const r = await run('sleep', ['10'], { timeoutMs: 200 })
    expect(r.timedOut).toBe(true)
  })

  it('rejects for a missing executable', async () => {
    await expect(run(join(tmp, 'nope'), [])).rejects.toThrow()
  })
})

describe('worker host', () => {
  it('runs selftest to completion with progress', async () => {
    const msgs: WorkerToMain[] = []
    const done = new Promise<void>((resolve) => {
      const host = createHost((m) => {
        msgs.push(m)
        if (m.type === 'done' || m.type === 'failed') resolve()
      })
      host({
        type: 'start',
        jobId: 'j1',
        kind: 'selftest',
        params: { steps: 3, delayMs: 10 },
        env: env()
      })
    })
    await done
    expect(msgs.at(-1)).toEqual({ type: 'done', jobId: 'j1', result: { steps: 3 } })
    expect(msgs.some((m) => m.type === 'log' && m.text === 'child ok')).toBe(true)
    expect(msgs.some((m) => m.type === 'progress' && m.progress === 1)).toBe(true)
  })

  it('cancels a running job', async () => {
    const msgs: WorkerToMain[] = []
    let host!: (m: MainToWorker) => void
    const end = new Promise<void>((resolve) => {
      host = createHost((m) => {
        msgs.push(m)
        if (m.type === 'cancelled' || m.type === 'done' || m.type === 'failed') resolve()
      })
    })
    host({
      type: 'start',
      jobId: 'j2',
      kind: 'selftest',
      params: { steps: 100, delayMs: 50 },
      env: env()
    })
    setTimeout(() => host({ type: 'cancel', jobId: 'j2' }), 200)
    await end
    expect(msgs.at(-1)).toEqual({ type: 'cancelled', jobId: 'j2' })
  })
})

describe('JobManager', () => {
  function fakeWorker(): { worker: WorkerLike; exit: (code: number) => void } {
    let onMsg: (m: WorkerToMain) => void = () => {}
    let onExit: (c: number) => void = () => {}
    const host = createHost((m) => setImmediate(() => onMsg(m)))
    const worker = {
      postMessage: (m: MainToWorker) => host(m),
      on: (ev: string, cb: (a: never) => void) => {
        if (ev === 'message') onMsg = cb as typeof onMsg
        else onExit = cb as typeof onExit
      },
      kill: () => true
    } as WorkerLike
    return { worker, exit: (c) => onExit(c) }
  }

  it('tracks a job through to done and emits updates', async () => {
    const updates: JobState[] = []
    const fw = fakeWorker()
    const jm = new JobManager(
      () => fw.worker,
      async () => env(),
      {
        onUpdate: (j) => updates.push({ ...j }),
        onLog: () => {}
      }
    )
    const final = await jm.run('selftest', { steps: 2, delayMs: 5 })
    expect(final.status).toBe('done')
    expect(final.progress).toBe(1)
    expect(updates[0].status).toBe('running')
    expect(jm.log(final.id).some((l) => l.text === 'child ok')).toBe(true)
  })

  it('fails running jobs when the worker dies', async () => {
    const fw = fakeWorker()
    const jm = new JobManager(
      () => fw.worker,
      async () => env(),
      { onUpdate: () => {}, onLog: () => {} }
    )
    const id = await jm.start('selftest', { steps: 100, delayMs: 50 })
    fw.exit(9)
    const final = await jm.wait(id)
    expect(final.status).toBe('failed')
    expect(final.error).toMatch(/exited unexpectedly/)
  })
})
