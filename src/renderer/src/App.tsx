import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/types'
import { DoctorPage } from './pages/Doctor'
import { JobsPage } from './pages/Jobs'
import { ProjectsPage } from './pages/Projects'
import { SettingsPage } from './pages/Settings'
import { useJobs } from './useJobs'

type Page = 'projects' | 'doctor' | 'jobs' | 'settings'

const PAGES: Array<{ id: Page; label: string }> = [
  { id: 'projects', label: 'Projects' },
  { id: 'doctor', label: 'Doctor' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('projects')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const jobs = useJobs()
  const running = jobs.filter((j) => j.status === 'running').length

  useEffect(() => {
    void window.hk.appInfo().then(setInfo)
  }, [])

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Hyper<span>Kitchen</span>
        </div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`nav ${page === p.id ? 'active' : ''}`}
            onClick={() => setPage(p.id)}
            data-testid={`nav-${p.id}`}
          >
            {p.label}
            {p.id === 'jobs' && running > 0 ? ` (${running})` : ''}
          </button>
        ))}
        <div className="sidebar-foot">
          {info ? (
            <>
              v{info.version} · {info.platformKey ?? `${info.platform}-${info.arch}`}
              <br />
              Electron {info.electron}
            </>
          ) : null}
        </div>
      </aside>
      <main className="main">
        {page === 'projects' && <ProjectsPage />}
        {page === 'doctor' && <DoctorPage jobs={jobs} />}
        {page === 'jobs' && <JobsPage jobs={jobs} />}
        {page === 'settings' && <SettingsPage info={info} />}
      </main>
    </div>
  )
}
