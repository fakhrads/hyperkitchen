import { useCallback, useEffect, useState } from 'react'
import type { JobState, ProjectSummary } from '../../../shared/types'
import { ProjectView } from './ProjectView'

export function ProjectsPage({ jobs }: { jobs: JobState[] }): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<ProjectSummary | null>(null)

  const refresh = useCallback(async () => setProjects(await window.hk.projects.list()), [])
  useEffect(() => {
    void window.hk.projects.list().then(setProjects)
  }, [])

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      // IPC errors arrive as "Error invoking remote method '...': Error: msg"
      setError(
        String((e as Error).message).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          ''
        )
      )
    }
  }

  const create = (): Promise<void> =>
    guard(async () => {
      const p = await window.hk.projects.create(name)
      setName('')
      setCurrent(p)
      await refresh()
    })

  const openExisting = (): Promise<void> =>
    guard(async () => {
      const dir = await window.hk.dialog.pickDir('Open HyperKitchen project')
      if (!dir) return
      setCurrent(await window.hk.projects.open(dir))
      await refresh()
    })

  return (
    <>
      <h1>Projects</h1>
      <p className="sub">
        A project is a working folder: the stock ROM is extracted once into <code>stock/</code>,
        every build copies it to <code>work/</code> and applies the recipe. The original ROM is
        never modified.
      </p>

      <div className="panel">
        <div className="row">
          <input
            type="text"
            placeholder="New project name, e.g. onyx-OS3.0.5-CN"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name && void create()}
            data-testid="project-name"
          />
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => void create()}
            data-testid="project-create"
          >
            Create
          </button>
          <button onClick={() => void openExisting()}>Open folder…</button>
        </div>
        {error && (
          <p className="error-text" data-testid="project-error">
            {error}
          </p>
        )}
      </div>

      {current && (
        <ProjectView
          key={current.path}
          project={current}
          jobs={jobs}
          onChanged={() => void refresh()}
        />
      )}

      <h2>Recent</h2>
      {projects.length === 0 ? (
        <div className="empty">No projects yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Device</th>
              <th>Created</th>
              <th>Path</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.path}>
                <td>{p.meta.name}</td>
                <td>{p.meta.device ?? <span className="empty">not loaded</span>}</td>
                <td>{new Date(p.meta.createdAt).toLocaleString()}</td>
                <td className="mono">{p.path}</td>
                <td>
                  <div className="row">
                    <button
                      onClick={() =>
                        void guard(async () => setCurrent(await window.hk.projects.open(p.path)))
                      }
                    >
                      Open
                    </button>
                    <button
                      title="Remove from this list. Files on disk are not touched."
                      onClick={() =>
                        void guard(async () => {
                          await window.hk.projects.forget(p.path)
                          await refresh()
                        })
                      }
                    >
                      Forget
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
