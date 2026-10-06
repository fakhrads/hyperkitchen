import { useEffect, useState } from 'react'
import type { AppInfo, Material, Settings } from '../../../shared/types'

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

      <MaterialsPanel />

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

const KIND_LABEL: Record<Material['kind'], string> = {
  gapps: 'MindTheGapps zip',
  'reference-rom': 'Reference ROM (unpacked project)',
  image: 'Image (logo / wallpaper)',
  app: 'App APK (modded launcher, etc.)'
}

function MaterialsPanel(): React.JSX.Element {
  const [materials, setMaterials] = useState<Material[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = (): void => void window.hk.materials.list().then(setMaterials)
  useEffect(reload, [])
  const add = async (kind: Material['kind']): Promise<void> => {
    const path =
      kind === 'reference-rom'
        ? await window.hk.dialog.pickDir('Choose an unpacked project folder')
        : await window.hk.dialog.pickFile(
            `Choose a ${kind === 'gapps' ? 'MindTheGapps zip' : 'image'}`,
            kind === 'gapps' ? ['zip'] : ['png', 'jpg', 'jpeg', 'webp']
          )
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      await window.hk.materials.add(kind, path, '')
      reload()
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="panel" data-testid="materials-panel">
      <h2 style={{ marginTop: 0 }}>Materials library</h2>
      <p className="sub" style={{ margin: '0 0 8px' }}>
        Register a GApps zip, a reference ROM or an image once; recipes then pick it from here
        instead of browsing every time. Files stay where they are on disk; nothing is copied into
        HyperKitchen. HyperKitchen never downloads any of them.
      </p>
      <div className="row">
        <button disabled={busy} onClick={() => void add('gapps')} data-testid="material-add-gapps">
          Add GApps zip…
        </button>
        <button disabled={busy} onClick={() => void add('reference-rom')}>
          Add reference ROM…
        </button>
        <button disabled={busy} onClick={() => void add('image')}>
          Add image…
        </button>
        <button disabled={busy} onClick={() => void add('app')} data-testid="material-add-app">
          Add app APK…
        </button>
        {busy && (
          <span className="sub" style={{ margin: 0 }}>
            Reading…
          </span>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      {materials.length > 0 && (
        <table style={{ marginTop: 8 }} data-testid="materials-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Label</th>
              <th>Path</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id}>
                <td>{KIND_LABEL[m.kind]}</td>
                <td>
                  {m.label}
                  {m.meta && (
                    <div className="sub">
                      {Object.entries(m.meta)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(' · ')}
                    </div>
                  )}
                </td>
                <td className="mono">{m.path}</td>
                <td>
                  <button
                    onClick={async () => {
                      await window.hk.materials.remove(m.id)
                      reload()
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
