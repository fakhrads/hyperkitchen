import { useEffect, useMemo, useState } from 'react'
import type { ModInfo, ModSummary, OverlayChange } from '../../../shared/appmod'
import type {
  ModFile,
  SearchHit,
  SmaliMethodInfo,
  StringResInfo,
  StubValue
} from '../../../shared/ipc'
import type { ApkInfo, DirEntry, JobState } from '../../../shared/types'
import { hunks, lineDiff } from '../diff'
import { errorText, formatSize } from '../format'
import { runJob } from '../useJobs'

function jobError(j: JobState): string | null {
  return j.status === 'done' ? null : (j.error ?? j.status)
}

/** Tree path of an inventory APK. */
const apkTreePath = (a: ApkInfo): string => `${a.partition}/${a.path}`

export function AppsTab({
  projectPath,
  apks,
  pendingTarget,
  onTargetConsumed
}: {
  projectPath: string
  apks: ApkInfo[]
  pendingTarget: string | null
  onTargetConsumed: () => void
}): React.JSX.Element {
  const [mods, setMods] = useState<ModSummary[]>([])
  const [inRecipe, setInRecipe] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [version, setVersion] = useState(0)
  const reload = (): void => setVersion((v) => v + 1)
  useEffect(() => {
    let alive = true
    void Promise.all([window.hk.mods.list(projectPath), window.hk.recipe.get(projectPath)]).then(
      ([m, r]) => {
        if (!alive) return
        setMods(m)
        setInRecipe(
          new Set(r.operations.flatMap((o) => (o.type === 'app-mod' ? [o.params.mod] : [])))
        )
      }
    )
    return () => {
      alive = false
    }
  }, [projectPath, version])

  const job = async (
    label: string,
    kind: JobState['kind'],
    params: Record<string, unknown>
  ): Promise<JobState | null> => {
    setBusy(label)
    setError(null)
    try {
      const j = await runJob(kind, { projectPath, ...params })
      const e = jobError(j)
      if (e) setError(e)
      return e ? null : j
    } catch (e) {
      setError(errorText(e))
      return null
    } finally {
      setBusy(null)
      reload()
    }
  }

  const create = async (target: string, resources: boolean): Promise<void> => {
    const j = await job(`decoding ${target}`, 'mod-create', { target, resources })
    if (j) setSelected((j.result as ModInfo).id)
  }

  useEffect(() => {
    if (!pendingTarget) return
    void window.hk.mods.list(projectPath).then((list) => {
      onTargetConsumed()
      const existing = list.find((m) => m.mod.target === pendingTarget)
      if (existing) setSelected(existing.mod.id)
      else void create(pendingTarget, true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTarget])

  const addToRecipe = async (id: string): Promise<void> => {
    const r = await window.hk.recipe.get(projectPath)
    if (r.operations.some((o) => o.type === 'app-mod' && o.params.mod === id)) return
    r.operations.push({ id: `mod-${id}`, type: 'app-mod', enabled: true, params: { mod: id } })
    await window.hk.recipe.save(projectPath, r)
    reload()
  }

  const current = mods.find((m) => m.mod.id === selected) ?? null

  return (
    <>
      <p className="sub">
        Open any APK of the ROM, edit its smali and resources, and keep the edits as a mod. A mod is
        applied again at every build onto a fresh decode, only the changed dex and (when edited) the
        resources are replaced, and the stock signing block is kept. Edits are checked against the
        stock decode, so a mod made on another ROM version is refused.
      </p>
      {error && <p className="error-text mono">{error}</p>}
      {busy && (
        <p className="sub" data-testid="apps-busy">
          {busy}…
        </p>
      )}
      <NewMod apks={apks} disabled={!!busy} onCreate={(t, r) => void create(t, r)} />
      {mods.length > 0 && (
        <table data-testid="mods-table" style={{ marginBottom: 14 }}>
          <thead>
            <tr>
              <th>Mod</th>
              <th>Target</th>
              <th>Changes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mods.map((m) => (
              <tr key={m.mod.id} style={m.mod.id === selected ? { fontWeight: 600 } : undefined}>
                <td className="mono">
                  {m.mod.id}
                  <div className="sub">{m.mod.resources ? 'smali + resources' : 'smali only'}</div>
                </td>
                <td className="mono">{m.mod.target}</td>
                <td>{m.changes.length} files</td>
                <td>
                  <div className="row">
                    <button
                      disabled={!!busy}
                      onClick={async () => {
                        if (!m.open) {
                          const j = await job(`decoding ${m.mod.target}`, 'mod-open', {
                            id: m.mod.id
                          })
                          if (!j) return
                        }
                        setSelected(m.mod.id)
                      }}
                    >
                      {m.mod.id === selected ? 'Editing' : 'Edit'}
                    </button>
                    {inRecipe.has(m.mod.id) ? (
                      <span className="badge ok">in recipe</span>
                    ) : (
                      <button
                        disabled={!m.changes.length}
                        title={m.changes.length ? '' : 'Save some changes first'}
                        onClick={() => void addToRecipe(m.mod.id)}
                      >
                        Add to recipe
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {current && current.open && (
        <ModEditor
          key={current.mod.id}
          projectPath={projectPath}
          summary={current}
          busy={!!busy}
          runJob={job}
        />
      )}
    </>
  )
}

function NewMod({
  apks,
  disabled,
  onCreate
}: {
  apks: ApkInfo[]
  disabled: boolean
  onCreate: (target: string, resources: boolean) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState('')
  const [resources, setResources] = useState(true)
  const options = useMemo(() => {
    const f = filter.toLowerCase()
    return apks
      .filter((a) => a.size > 0 && !a.error)
      .filter(
        (a) =>
          !f ||
          apkTreePath(a).toLowerCase().includes(f) ||
          (a.packageName ?? '').toLowerCase().includes(f)
      )
      .slice(0, 200)
  }, [apks, filter])
  return (
    <div className="panel">
      <div className="row">
        <strong>Open an app</strong>
        <input
          type="text"
          placeholder="Filter by package or path"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="mod-filter"
        />
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          data-testid="mod-target"
          style={{ maxWidth: 520 }}
        >
          <option value="">Choose an APK ({options.length})</option>
          {options.map((a) => (
            <option key={apkTreePath(a)} value={apkTreePath(a)}>
              {a.packageName} ({apkTreePath(a)})
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={resources}
            onChange={(e) => setResources(e.target.checked)}
          />{' '}
          Decode resources (strings, layouts)
        </label>
        <button
          className="primary"
          disabled={disabled || !target}
          onClick={() => onCreate(target, resources)}
          data-testid="mod-create"
        >
          Open in editor
        </button>
      </div>
      <p className="sub" style={{ margin: '6px 0 0' }}>
        Resources need the ROM&apos;s framework APKs; HyperKitchen installs every resource provider
        of the stock tree (framework-res, framework-ext-res, miuisystem, miuix, …) into the project
        once. Without resources only smali can be edited, and the resource table stays byte for byte
        as in stock.
      </p>
    </div>
  )
}

type Pane = 'file' | 'methods' | 'strings' | 'changes'

function ModEditor({
  projectPath,
  summary,
  busy,
  runJob: job
}: {
  projectPath: string
  summary: ModSummary
  busy: boolean
  runJob: (
    label: string,
    kind: JobState['kind'],
    params: Record<string, unknown>
  ) => Promise<JobState | null>
}): React.JSX.Element {
  const { mod } = summary
  const [path, setPath] = useState<string | null>(null)
  const [pane, setPane] = useState<Pane>('file')
  const [exported, setExported] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const save = async (): Promise<void> => {
    await job('saving changes', 'mod-save', { id: mod.id })
  }
  const exportApk = async (): Promise<void> => {
    const j = await job('building the modded APK', 'mod-export', { id: mod.id })
    if (j) setExported((j.result as { path: string }).path)
  }
  const [adb, setAdb] = useState<{ apk: string; certSha256: string } | null>(null)
  const adbPackage = async (): Promise<void> => {
    if (
      !window.confirm(
        `Re-sign ${mod.packageName ?? mod.id} with the project key for adb install?\n\n` +
          'The re-signed app is not Xiaomi-signed: it cannot replace the copy in the ROM, and it ' +
          'gets no store or OTA updates. HyperKitchen only writes the APK and the scripts; you ' +
          'run them.'
      )
    )
      return
    const j = await job('building the adb package', 'mod-adb', { id: mod.id })
    if (j) setAdb(j.result as { apk: string; certSha256: string })
  }
  const reset = async (): Promise<void> => {
    if (!window.confirm('Discard unsaved edits and reload the working copy from the saved mod?'))
      return
    await job('reloading', 'mod-open', { id: mod.id, reset: true })
    setReloadKey((k) => k + 1)
  }

  return (
    <div className="panel" data-testid="mod-editor">
      <div className="row" style={{ marginBottom: 10 }}>
        <strong className="mono">{mod.id}</strong>
        <span className="sub" style={{ margin: 0 }}>
          {mod.packageName ?? ''} · {mod.target}
        </span>
        <span style={{ flex: 1 }} />
        <button disabled={busy} onClick={() => void reset()}>
          Reload saved
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void save()}
          data-testid="mod-save"
        >
          Save changes
        </button>
        <button
          disabled={busy || !summary.changes.length}
          onClick={() => void exportApk()}
          title="Build this app alone into mods/<id>/out"
        >
          Build APK
        </button>
        <button
          disabled={busy || !summary.changes.length || !mod.target.endsWith('.apk')}
          onClick={() => void adbPackage()}
          title="Re-signed APK plus adb install scripts in mods/<id>/adb-package"
          data-testid="mod-adb"
        >
          adb package
        </button>
      </div>
      {adb && (
        <div className="panel" style={{ borderColor: 'var(--error)' }} data-testid="mod-adb-result">
          <p className="error-text" style={{ margin: '0 0 6px' }}>
            <strong>Re-signed with the project key</strong>: {mod.packageName} can no longer be
            updated from the store or OTA, and it cannot replace the Xiaomi-signed copy that a
            system app has in the ROM (adb install fails with UPDATE_INCOMPATIBLE).
          </p>
          <p className="sub" style={{ margin: 0 }}>
            <span className="mono">{adb.apk}</span>, certificate SHA-256{' '}
            <span className="mono">{adb.certSha256}</span>. Run{' '}
            <span className="mono">macos_adb_install.sh</span>,{' '}
            <span className="mono">linux_adb_install.sh</span> or{' '}
            <span className="mono">windows_adb_install.bat</span> yourself; HyperKitchen never runs
            adb.{' '}
            <button onClick={() => void window.hk.mods.reveal(projectPath, mod.id, 'adb-package')}>
              Show
            </button>
          </p>
        </div>
      )}
      {exported && (
        <p className="sub">
          Built <span className="mono">{exported}</span>. It keeps the stock signing block: it is
          for the ROM image (add the mod to the recipe and build), adb cannot install it.{' '}
          <button onClick={() => void window.hk.mods.reveal(projectPath, mod.id, 'out')}>
            Show
          </button>
        </p>
      )}
      <p className="sub" style={{ margin: '0 0 10px' }}>
        Edits go to the working copy immediately; <strong>Save changes</strong> records them as the
        mod (what builds use). Saved: {summary.changes.length} files.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12 }}>
        <div>
          <SearchBox
            projectPath={projectPath}
            id={mod.id}
            onOpen={(p) => {
              setPath(p)
              setPane('file')
            }}
          />
          <Tree
            key={reloadKey}
            projectPath={projectPath}
            id={mod.id}
            selected={path}
            onOpen={(p) => {
              setPath(p)
              setPane(p.endsWith('.smali') ? pane : 'file')
            }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            {(
              [
                ['file', 'File'],
                ['methods', 'Methods'],
                ['strings', 'Strings'],
                ['changes', 'Saved changes']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={pane === id ? 'primary' : ''}
                onClick={() => setPane(id)}
                data-testid={`mod-pane-${id}`}
              >
                {label}
              </button>
            ))}
          </div>
          {pane === 'file' && (
            <FileEditor
              key={`${path}:${reloadKey}`}
              projectPath={projectPath}
              id={mod.id}
              path={path}
            />
          )}
          {pane === 'methods' && (
            <Methods
              key={`${path}:${reloadKey}`}
              projectPath={projectPath}
              id={mod.id}
              path={path}
            />
          )}
          {pane === 'strings' && (
            <Strings
              key={reloadKey}
              projectPath={projectPath}
              id={mod.id}
              resources={mod.resources}
            />
          )}
          {pane === 'changes' && (
            <Changes
              changes={summary.changes}
              onOpen={(p) => {
                setPath(p)
                setPane('file')
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function Tree({
  projectPath,
  id,
  selected,
  onOpen
}: {
  projectPath: string
  id: string
  selected: string | null
  onOpen: (path: string) => void
}): React.JSX.Element {
  const [dir, setDir] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.hk.mods
      .listDir(projectPath, id, dir)
      .then((e) => alive && (setEntries(e), setError(null)))
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [projectPath, id, dir])
  const parts = dir ? dir.split('/') : []
  return (
    <div className="log" style={{ maxHeight: 520, whiteSpace: 'normal' }} data-testid="mod-tree">
      <div className="row" style={{ gap: 2, marginBottom: 6 }}>
        <a href="#" onClick={(e) => (e.preventDefault(), setDir(''))}>
          /
        </a>
        {parts.map((p, i) => (
          <span key={i}>
            <a
              href="#"
              onClick={(e) => (e.preventDefault(), setDir(parts.slice(0, i + 1).join('/')))}
            >
              {p}
            </a>
            /
          </span>
        ))}
      </div>
      {error && <div className="error-text">{error}</div>}
      {entries.map((e) => {
        const rel = dir ? `${dir}/${e.name}` : e.name
        return (
          <div key={e.name}>
            <a
              href="#"
              style={rel === selected ? { fontWeight: 700 } : undefined}
              onClick={(ev) => {
                ev.preventDefault()
                if (e.type === 'dir') setDir(rel)
                else onOpen(rel)
              }}
            >
              {e.type === 'dir' ? `${e.name}/` : e.name}
            </a>
            {e.type === 'file' && <span className="sub"> {formatSize(e.size)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function SearchBox({
  projectPath,
  id,
  onOpen
}: {
  projectPath: string
  id: string
  onOpen: (path: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ hits: SearchHit[]; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const search = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      const j = await runJob('mod-search', { projectPath, id, query, regex })
      if (j.status !== 'done') setError(j.error ?? j.status)
      else setResult(j.result as { hits: SearchHit[]; truncated: boolean })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setRunning(false)
    }
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="row" style={{ gap: 4 }}>
        <input
          type="text"
          style={{ minWidth: 0, flex: 1 }}
          placeholder="Search code and resources"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && query && void search()}
          data-testid="mod-search"
        />
        <label title="Regular expression">
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
          .*
        </label>
        <button disabled={!query || running} onClick={() => void search()}>
          {running ? '…' : 'Find'}
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
      {result && (
        <div className="log" style={{ maxHeight: 240, marginTop: 6 }} data-testid="mod-hits">
          {result.hits.length} hits{result.truncated ? ' (first 1000)' : ''}
          {result.hits.map((h, i) => (
            <div key={i}>
              <a href="#" onClick={(e) => (e.preventDefault(), onOpen(h.path))}>
                {h.path}
                {h.line ? `:${h.line}` : ''}
              </a>{' '}
              <span className="sub">{h.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FileEditor({
  projectPath,
  id,
  path
}: {
  projectPath: string
  id: string
  path: string | null
}): React.JSX.Element {
  const [file, setFile] = useState<ModFile | null>(null)
  const [text, setText] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const load = (): void => setVersion((v) => v + 1)
  useEffect(() => {
    if (!path) return
    let alive = true
    window.hk.mods
      .read(projectPath, id, path)
      .then((f) => {
        if (!alive) return
        setFile(f)
        setText(f.text ?? '')
        setMsg(null)
      })
      .catch((e) => alive && setMsg(errorText(e)))
    return () => {
      alive = false
    }
  }, [projectPath, id, path, version])
  if (!path) return <p className="empty">Choose a file in the tree or the search results.</p>
  if (!file) return <p className="empty">{msg ?? 'Loading…'}</p>
  const dirty = file.text !== null && text !== file.text
  const changed = file.baseText === null || (file.text ?? '') !== file.baseText
  const diff = showDiff && file.baseText !== null ? lineDiff(file.baseText, text) : null
  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="mono">{path}</span>
        {file.baseText === null ? (
          <span className="badge warn">added</span>
        ) : changed ? (
          <span className="badge warn">edited</span>
        ) : null}
        <span style={{ flex: 1 }} />
        <button
          disabled={!dirty}
          className={dirty ? 'primary' : ''}
          onClick={async () => {
            await window.hk.mods.write(projectPath, id, path, text)
            load()
          }}
          data-testid="file-write"
        >
          Write file
        </button>
        <button
          disabled={!changed && !dirty}
          onClick={async () => {
            if (!window.confirm(`Put ${path} back as in stock?`)) return
            await window.hk.mods.revert(projectPath, id, path)
            load()
          }}
        >
          Revert to stock
        </button>
        <label>
          <input
            type="checkbox"
            checked={showDiff}
            onChange={(e) => setShowDiff(e.target.checked)}
          />{' '}
          Diff vs stock
        </label>
      </div>
      {msg && <p className="error-text">{msg}</p>}
      {file.text === null ? (
        <p className="empty">
          Binary or larger than 8 MiB ({formatSize(file.size)}); not editable here.
        </p>
      ) : showDiff ? (
        diff ? (
          <div className="log" style={{ maxHeight: 560 }} data-testid="file-diff">
            {hunks(diff).map((l, i) =>
              l === null ? (
                <div key={i} className="sub">
                  ⋯
                </div>
              ) : (
                <div
                  key={i}
                  style={{
                    color:
                      l.kind === '+' ? 'var(--ok)' : l.kind === '-' ? 'var(--error)' : undefined
                  }}
                >
                  {l.kind} {l.text}
                </div>
              )
            )}
            {!diff.some((l) => l.kind !== ' ') && <div className="sub">No differences.</div>}
          </div>
        ) : (
          <p className="empty">Too many changed lines to show a diff.</p>
        )
      ) : (
        <textarea
          className="mono"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: '100%', height: 560, whiteSpace: 'pre', tabSize: 4 }}
          data-testid="file-text"
        />
      )}
    </>
  )
}

const STUB_LABEL: Record<string, string> = {
  void: 'return-void',
  '0': 'return 0 / false',
  '1': 'return 1 / true',
  null: 'return null'
}

function stubChoices(returnType: string): StubValue[] {
  if (returnType === 'V') return ['void']
  if (returnType === 'Z') return [0, 1]
  if (/^[BSCIJFD]$/.test(returnType)) return [0]
  return ['null']
}

function Methods({
  projectPath,
  id,
  path
}: {
  projectPath: string
  id: string
  path: string | null
}): React.JSX.Element {
  const [methods, setMethods] = useState<SmaliMethodInfo[]>([])
  const [filter, setFilter] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const load = (): void => setVersion((v) => v + 1)
  useEffect(() => {
    if (!path?.endsWith('.smali')) return
    let alive = true
    void window.hk.mods.methods(projectPath, id, path).then((m) => alive && setMethods(m))
    return () => {
      alive = false
    }
  }, [projectPath, id, path, version])
  if (!path?.endsWith('.smali')) return <p className="empty">Open a .smali file first.</p>
  const rows = methods.filter((m) => m.sig.toLowerCase().includes(filter.toLowerCase()))
  return (
    <>
      <p className="sub">
        A stub replaces the whole method body with a constant return (annotations are kept). This is
        the usual way to switch features off, e.g. an ad check that returns false. Use{' '}
        <strong>Diff vs stock</strong> in the File pane to review.
      </p>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="mono">{path}</span>
        <input
          type="text"
          placeholder="Filter methods"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {msg && <p className="error-text">{msg}</p>}
      <table data-testid="methods-table">
        <tbody>
          {rows.map((m) => {
            const noBody = m.modifiers.includes('abstract') || m.modifiers.includes('native')
            return (
              <tr key={m.sig}>
                <td className="mono">
                  {m.sig}
                  <div className="sub">
                    {m.modifiers.join(' ')} · line {m.line}
                  </div>
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {noBody ? (
                      <span className="sub">no body</span>
                    ) : (
                      stubChoices(m.returnType).map((v) => (
                        <button
                          key={String(v)}
                          onClick={async () => {
                            try {
                              await window.hk.mods.stub(projectPath, id, path, m.sig, v)
                              setMsg(null)
                              load()
                            } catch (e) {
                              setMsg(errorText(e))
                            }
                          }}
                        >
                          {STUB_LABEL[String(v)]}
                        </button>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function Strings({
  projectPath,
  id,
  resources
}: {
  projectPath: string
  id: string
  resources: boolean
}): React.JSX.Element {
  const [locales, setLocales] = useState<string[]>([])
  const [values, setValues] = useState('values')
  const [rows, setRows] = useState<StringResInfo[]>([])
  const [filter, setFilter] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!resources) return
    void window.hk.mods.stringLocales(projectPath, id).then(setLocales)
  }, [projectPath, id, resources])
  useEffect(() => {
    if (!resources || !locales.includes(values)) return
    void window.hk.mods.strings(projectPath, id, values).then((r) => {
      setRows(r)
      setEdits({})
    })
  }, [projectPath, id, values, locales, resources])
  if (!resources)
    return <p className="empty">This mod was opened without resources; only smali is editable.</p>
  const set = async (name: string, value: string | null): Promise<void> => {
    try {
      setRows(await window.hk.mods.setString(projectPath, id, values, name, value))
      setEdits((e) => {
        const n = { ...e }
        delete n[name]
        return n
      })
      setMsg(null)
    } catch (e) {
      setMsg(errorText(e))
    }
  }
  const f = filter.toLowerCase()
  const shown = rows
    .filter((r) => !f || r.name.toLowerCase().includes(f) || r.value.toLowerCase().includes(f))
    .slice(0, 300)
  return (
    <>
      <div className="row" style={{ marginBottom: 6 }}>
        <select
          value={values}
          onChange={(e) => setValues(e.target.value)}
          data-testid="strings-locale"
        >
          {locales.map((l) => (
            <option key={l} value={l}>
              res/{l}/strings.xml
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by name or text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="sub" style={{ margin: 0 }}>
          {shown.length} of {rows.length}
        </span>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          type="text"
          placeholder="new_string_name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ minWidth: 200 }}
          data-testid="string-new-name"
        />
        <input
          type="text"
          placeholder="Text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          data-testid="string-new-value"
        />
        <button
          disabled={!newName}
          onClick={async () => {
            await set(newName, newValue)
            setNewName('')
            setNewValue('')
          }}
          data-testid="string-add"
        >
          Add / set
        </button>
      </div>
      <p className="sub">
        A string added only to res/{values}/ exists for that locale and its fallbacks; add it to
        res/values/ so every locale has it. New names get a new resource ID; existing IDs never
        change (the build checks public.xml).
      </p>
      {msg && <p className="error-text">{msg}</p>}
      <table data-testid="strings-table">
        <tbody>
          {shown.map((r) => {
            const v = edits[r.name] ?? r.value
            return (
              <tr key={r.name}>
                <td className="mono" style={{ width: '35%' }}>
                  {r.name}
                  {r.attrs && <div className="sub">{r.attrs}</div>}
                </td>
                <td>
                  <textarea
                    value={v}
                    rows={Math.min(4, v.split('\n').length)}
                    onChange={(e) => setEdits({ ...edits, [r.name]: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </td>
                <td style={{ width: 150 }}>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      disabled={edits[r.name] === undefined}
                      onClick={() => void set(r.name, v)}
                    >
                      Set
                    </button>
                    <button
                      onClick={() =>
                        window.confirm(`Remove string ${r.name} from res/${values}?`) &&
                        void set(r.name, null)
                      }
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function Changes({
  changes,
  onOpen
}: {
  changes: OverlayChange[]
  onOpen: (path: string) => void
}): React.JSX.Element {
  if (!changes.length) return <p className="empty">Nothing saved yet.</p>
  return (
    <table data-testid="changes-table">
      <tbody>
        {changes.map((c) => (
          <tr key={c.path}>
            <td>
              <span className={`badge ${c.kind === 'deleted' ? 'error' : 'warn'}`}>{c.kind}</span>
            </td>
            <td className="mono">
              {c.kind === 'deleted' ? (
                c.path
              ) : (
                <a href="#" onClick={(e) => (e.preventDefault(), onOpen(c.path))}>
                  {c.path}
                </a>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
