import { randomUUID } from 'node:crypto'
import type { JobKind, JobLogLine, JobState } from '../shared/types'
import type { MainToWorker, WorkerEnv, WorkerToMain } from '../shared/worker-protocol'

/** Minimal surface of an Electron UtilityProcess, so tests can supply a fake. */
export interface WorkerLike {
  postMessage(msg: MainToWorker): void
  on(event: 'message', cb: (msg: WorkerToMain) => void): void
  on(event: 'exit', cb: (code: number) => void): void
  kill(): boolean
}

const TITLES: Record<JobKind, string> = {
  selftest: 'Self-test',
  doctor: 'Doctor',
  'java-install': 'Install Java (Temurin JRE)',
  'clear-quarantine': 'Clear macOS quarantine',
  unpack: 'Unpack ROM',
  build: 'Build ROM',
  'mod-create': 'Open app in editor',
  'mod-open': 'Decode app',
  'mod-save': 'Save app changes',
  'mod-search': 'Search app',
  'mod-export': 'Build modded app'
}

const MAX_LOG_LINES = 5000

export interface JobManagerEvents {
  onUpdate(job: JobState): void
  onLog(line: JobLogLine): void
}

export class JobManager {
  private worker: WorkerLike | null = null
  private readonly jobs = new Map<string, JobState>()
  private readonly logs = new Map<string, JobLogLine[]>()
  private readonly waiters = new Map<string, Array<(job: JobState) => void>>()

  constructor(
    private readonly spawnWorker: () => WorkerLike,
    private readonly envFor: () => Promise<WorkerEnv>,
    private readonly events: JobManagerEvents
  ) {}

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker
    const w = this.spawnWorker()
    w.on('message', (m: WorkerToMain) => this.handle(m))
    w.on('exit', (code: number) => {
      if (this.worker !== w) return
      this.worker = null
      // Anything still running died with the worker.
      for (const job of this.jobs.values()) {
        if (job.status === 'running') {
          this.finish(job, 'failed', { error: `job runner exited unexpectedly (code ${code})` })
        }
      }
    })
    this.worker = w
    return w
  }

  list(): JobState[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  log(id: string): JobLogLine[] {
    return this.logs.get(id) ?? []
  }

  async start(kind: JobKind, params: Record<string, unknown> = {}): Promise<string> {
    if (!(kind in TITLES)) throw new Error(`unknown job kind: ${kind}`)
    const env = await this.envFor()
    const id = randomUUID()
    const job: JobState = {
      id,
      kind,
      title: TITLES[kind],
      status: 'running',
      progress: null,
      step: 'starting',
      startedAt: Date.now(),
      endedAt: null,
      error: null,
      result: null
    }
    this.jobs.set(id, job)
    this.logs.set(id, [])
    this.events.onUpdate(job)
    this.ensureWorker().postMessage({ type: 'start', jobId: id, kind, params, env })
    return id
  }

  /** Start a job and resolve once it reaches a terminal state. */
  async run(kind: JobKind, params: Record<string, unknown> = {}): Promise<JobState> {
    const id = await this.start(kind, params)
    return this.wait(id)
  }

  wait(id: string): Promise<JobState> {
    const job = this.jobs.get(id)
    if (!job) return Promise.reject(new Error(`no job ${id}`))
    if (job.status !== 'running') return Promise.resolve(job)
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? []
      list.push(resolve)
      this.waiters.set(id, list)
    })
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (job?.status === 'running') this.worker?.postMessage({ type: 'cancel', jobId: id })
  }

  dispose(): void {
    this.worker?.kill()
    this.worker = null
  }

  private handle(m: WorkerToMain): void {
    const job = this.jobs.get(m.jobId)
    if (!job || job.status !== 'running') return
    switch (m.type) {
      case 'progress':
        job.progress = m.progress
        if (m.step) job.step = m.step
        this.events.onUpdate(job)
        break
      case 'log': {
        const line: JobLogLine = { jobId: m.jobId, ts: Date.now(), stream: m.stream, text: m.text }
        const buf = this.logs.get(m.jobId) ?? []
        buf.push(line)
        if (buf.length > MAX_LOG_LINES) buf.splice(0, buf.length - MAX_LOG_LINES)
        this.logs.set(m.jobId, buf)
        this.events.onLog(line)
        break
      }
      case 'done':
        this.finish(job, 'done', { result: m.result })
        break
      case 'failed':
        this.finish(job, 'failed', { error: m.error })
        break
      case 'cancelled':
        this.finish(job, 'cancelled', {})
        break
    }
  }

  private finish(job: JobState, status: JobState['status'], extra: Partial<JobState>): void {
    Object.assign(job, extra, { status, endedAt: Date.now() })
    if (status === 'done') job.progress = 1
    job.step = status
    this.events.onUpdate(job)
    for (const w of this.waiters.get(job.id) ?? []) w(job)
    this.waiters.delete(job.id)
  }
}
