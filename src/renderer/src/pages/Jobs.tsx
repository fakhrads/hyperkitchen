import { useEffect, useRef, useState } from 'react'
import type { JobLogLine, JobState } from '../../../shared/types'

export function ProgressBar({ job }: { job: JobState }): React.JSX.Element {
  const indeterminate = job.status === 'running' && job.progress === null
  return (
    <div
      className={`progress ${indeterminate ? 'indeterminate' : ''}`}
      style={{ display: 'inline-block', width: 180 }}
    >
      <div style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
    </div>
  )
}

function JobLog({ jobId }: { jobId: string }): React.JSX.Element {
  const [lines, setLines] = useState<JobLogLine[]>([])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    void window.hk.jobs.log(jobId).then((l) => alive && setLines(l))
    const off = window.hk.jobs.onLog(
      (line) => line.jobId === jobId && setLines((prev) => [...prev, line].slice(-5000))
    )
    return () => {
      alive = false
      off()
    }
  }, [jobId])
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight)
  }, [lines])
  return (
    <div className="log" ref={ref} data-testid="job-log">
      {lines.length === 0 ? <span className="empty">(no output)</span> : null}
      {lines.map((l, i) => (
        <div key={i} className={l.stream}>
          {l.text}
        </div>
      ))}
    </div>
  )
}

export function JobsPage({ jobs }: { jobs: JobState[] }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const sel = jobs.find((j) => j.id === selected) ?? null

  return (
    <>
      <h1>Jobs</h1>
      <p className="sub">
        Long tasks run in a separate process. The window stays responsive and every job can be
        cancelled.
      </p>
      <div className="panel">
        <button
          onClick={() => void window.hk.jobs.start('selftest', { steps: 20, delayMs: 150 })}
          data-testid="selftest-start"
        >
          Run self-test
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="empty">No jobs yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Status</th>
              <th>Job</th>
              <th style={{ width: 200 }}>Progress</th>
              <th>Step</th>
              <th style={{ width: 90 }}>Time</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} data-testid={`job-${j.kind}`} data-status={j.status}>
                <td>
                  <span className={`badge ${j.status}`}>{j.status}</span>
                </td>
                <td>
                  {j.title}
                  {j.error && <div className="error-text mono">{j.error}</div>}
                </td>
                <td>
                  <ProgressBar job={j} />
                </td>
                <td>{j.step}</td>
                <td>{j.endedAt ? `${((j.endedAt - j.startedAt) / 1000).toFixed(1)}s` : ''}</td>
                <td>
                  <div className="row">
                    <button onClick={() => setSelected(j.id === selected ? null : j.id)}>
                      Log
                    </button>
                    {j.status === 'running' && (
                      <button
                        onClick={() => void window.hk.jobs.cancel(j.id)}
                        data-testid="job-cancel"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && (
        <>
          <h2>Log: {sel.title}</h2>
          <JobLog jobId={sel.id} />
        </>
      )}
    </>
  )
}
