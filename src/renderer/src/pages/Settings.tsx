import { useEffect, useState } from 'react'
import type { AppInfo, Settings } from '../../../shared/types'

export function SettingsPage({ info }: { info: AppInfo | null }): React.JSX.Element {
  const [s, setS] = useState<Settings | null>(null)
  const [javaPath, setJavaPath] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    void window.hk.settings.get().then((v) => {
      setS(v)
      setJavaPath(v.javaPath)
    })
  }, [])

  const save = async (patch: Parameters<typeof window.hk.settings.update>[0]): Promise<void> => {
    try {
      const next = await window.hk.settings.update(patch)
      setS(next)
      setMsg('Saved.')
    } catch (e) {
      setMsg(String((e as Error).message))
    }
  }

  if (!s) return <div className="empty">Loading…</div>

  return (
    <>
      <h1>Settings</h1>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Projects folder</h2>
        <div className="row">
          <span className="mono">{s.projectsRoot}</span>
          <button
            onClick={async () => {
              const dir = await window.hk.dialog.pickDir('Choose projects folder')
              if (dir) await save({ projectsRoot: dir })
            }}
          >
            Change…
          </button>
        </div>
        <p className="sub" style={{ margin: '8px 0 0' }}>
          Put this on a fast disk with plenty of space. On APFS (macOS) or btrfs/xfs (Linux) build
          copies are instant.
        </p>

        <h2>Java executable</h2>
        <div className="row">
          <input
            type="text"
            placeholder="Empty = auto-detect (managed JRE, JAVA_HOME, PATH)"
            value={javaPath}
            onChange={(e) => setJavaPath(e.target.value)}
          />
          <button onClick={() => void save({ javaPath: javaPath.trim() })}>Save</button>
        </div>
        {msg && <p className="sub">{msg}</p>}
      </div>

      {info && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>About this install</h2>
          <table>
            <tbody>
              <tr>
                <th>Version</th>
                <td>
                  {info.version} (Electron {info.electron}, Node {info.node})
                  {info.packaged ? '' : ' · dev'}
                </td>
              </tr>
              <tr>
                <th>Platform</th>
                <td>{info.platformKey ?? `${info.platform}-${info.arch} (unsupported)`}</td>
              </tr>
              <tr>
                <th>Binaries</th>
                <td className="mono">{info.binDir}</td>
              </tr>
              <tr>
                <th>Jars</th>
                <td className="mono">{info.commonBinDir}</td>
              </tr>
              <tr>
                <th>App data</th>
                <td className="mono">{info.userData}</td>
              </tr>
            </tbody>
          </table>
          <p className="sub" style={{ margin: '10px 0 0' }}>
            HyperKitchen only writes files. It never runs fastboot or adb and never writes to a
            device.
          </p>
        </div>
      )}
    </>
  )
}
