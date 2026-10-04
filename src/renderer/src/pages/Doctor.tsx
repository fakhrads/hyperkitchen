import { useEffect, useState } from 'react'
import type { DoctorCheck, DoctorReport, JobState } from '../../../shared/types'
import { ProgressBar } from './Jobs'

const GROUPS: Array<{ id: DoctorCheck['group']; title: string }> = [
  { id: 'host', title: 'Host' },
  { id: 'java', title: 'Java' },
  { id: 'binaries', title: 'Bundled tools' }
]

export function DoctorPage({ jobs }: { jobs: JobState[] }): React.JSX.Element {
  // Report from before this window subscribed (e.g. the launch-time run).
  const [initial, setInitial] = useState<DoctorReport | null>(null)
  const latestDoctor = jobs.find((j) => j.kind === 'doctor')
  const lastDone = jobs.find((j) => j.kind === 'doctor' && j.status === 'done')
  const report = (lastDone?.result as DoctorReport | undefined) ?? initial
  const javaJob = jobs.find((j) => j.kind === 'java-install')
  const busy = latestDoctor?.status === 'running' || javaJob?.status === 'running'

  useEffect(() => {
    void window.hk.doctor.last().then(setInitial)
  }, [])

  // Re-run the doctor after a Java install or quarantine clear finishes.
  const rerunAfter = async (kind: JobState['kind']): Promise<void> => {
    const id = await window.hk.jobs.start(kind)
    const off = window.hk.jobs.onUpdate((j) => {
      if (j.id === id && j.status !== 'running') {
        off()
        void window.hk.jobs.start('doctor')
      }
    })
  }

  const javaCheck = report?.checks.find((c) => c.id === 'java')
  const quarantine = report?.checks.find((c) => c.id === 'host:quarantine')
  const counts = report
    ? (['ok', 'warn', 'error'] as const).map(
        (s) => `${report.checks.filter((c) => c.status === s).length} ${s}`
      )
    : []

  return (
    <>
      <h1>Doctor</h1>
      <p className="sub">
        Checks that every host tool HyperKitchen drives is present and runs on this machine.
      </p>

      <div className="panel">
        <div className="row">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void window.hk.jobs.start('doctor')}
            data-testid="doctor-run"
          >
            Run checks
          </button>
          {javaCheck && javaCheck.status !== 'ok' && (
            <button
              disabled={busy}
              onClick={() => void rerunAfter('java-install')}
              data-testid="java-install"
            >
              Install Java (Temurin 21 JRE, ~50 MB)
            </button>
          )}
          {quarantine?.status === 'warn' && (
            <button disabled={busy} onClick={() => void rerunAfter('clear-quarantine')}>
              Clear quarantine
            </button>
          )}
          {report && (
            <span className="sub" style={{ margin: 0 }}>
              {counts.join(' · ')}
            </span>
          )}
        </div>
        {latestDoctor?.status === 'running' && (
          <div style={{ marginTop: 10 }}>
            <ProgressBar job={latestDoctor} /> <span className="sub">{latestDoctor.step}</span>
          </div>
        )}
        {javaJob?.status === 'running' && (
          <div style={{ marginTop: 10 }}>
            <ProgressBar job={javaJob} /> <span className="sub">{javaJob.step}</span>
          </div>
        )}
        {javaJob?.status === 'failed' && (
          <p className="error-text">Java install failed: {javaJob.error}</p>
        )}
      </div>

      {!report ? (
        <div className="empty">No report yet.</div>
      ) : (
        GROUPS.map((g) => (
          <div key={g.id}>
            <h2>{g.title}</h2>
            <table data-testid={`doctor-${g.id}`}>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Status</th>
                  <th style={{ width: 200 }}>Item</th>
                  <th style={{ width: 150 }}>Version</th>
                  <th>Detail</th>
                  <th style={{ width: 110 }}>Needed for</th>
                </tr>
              </thead>
              <tbody>
                {report.checks
                  .filter((c) => c.group === g.id)
                  .map((c) => (
                    <tr key={c.id} data-testid={`check-${c.id}`} data-status={c.status}>
                      <td>
                        <span className={`badge ${c.status}`}>{c.status}</span>
                      </td>
                      <td>{c.label}</td>
                      <td className="mono">{c.version ?? ''}</td>
                      <td className="mono">{c.detail}</td>
                      <td>{c.neededFor ?? ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </>
  )
}
