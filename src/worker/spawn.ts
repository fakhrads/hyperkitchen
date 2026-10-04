import { spawn } from 'node:child_process'
import { CancelledError } from './context'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Called per output line (stdout and stderr, ANSI colour codes stripped). */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  /** Kill the process after this many ms. Mainly for probes. */
  timeoutMs?: number
  /** Keep at most this many bytes of combined output in the result. */
  maxCapture?: number
}

export interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  output: string
  timedOut: boolean
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

/**
 * Spawn a host binary and stream its output. The child runs in its own process
 * group so cancel kills the whole tree, not just the direct child.
 * Never use a shell: arguments are passed as an array.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const maxCapture = opts.maxCapture ?? 256 * 1024
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError())
    let child
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      })
    } catch (e) {
      return reject(e)
    }

    let output = ''
    let timedOut = false
    let cancelled = false
    const partial = { stdout: '', stderr: '' }

    const killTree = (): void => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
      setTimeout(() => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }, 3000).unref()
    }

    const onAbort = (): void => {
      cancelled = true
      killTree()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true
            killTree()
          }, opts.timeoutMs)
        : null

    const feed = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const text = stripAnsi(chunk.toString('utf8'))
      if (output.length < maxCapture) output += text.slice(0, maxCapture - output.length)
      if (!opts.onLine) return
      const lines = (partial[stream] + text).split(/\r?\n|\r/)
      partial[stream] = lines.pop() ?? ''
      for (const l of lines) if (l.length) opts.onLine(l, stream)
    }
    child.stdout.on('data', (c: Buffer) => feed('stdout', c))
    child.stderr.on('data', (c: Buffer) => feed('stderr', c))

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code, sig) => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      for (const s of ['stdout', 'stderr'] as const) {
        if (partial[s] && opts.onLine) opts.onLine(partial[s], s)
      }
      if (cancelled) return reject(new CancelledError())
      resolve({ code, signal: sig, output, timedOut })
    })
  })
}
