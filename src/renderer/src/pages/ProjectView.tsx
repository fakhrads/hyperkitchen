import { useEffect, useMemo, useState } from 'react'
import type {
  ApkInfo,
  BuildInfo,
  DirEntry,
  Inventory,
  JobState,
  ProjectSummary,
  StockInfo,
  VerityMode
} from '../../../shared/types'
import type { ApkUpdateResult } from '../../../shared/ipc'
import { compareBuildFlash } from '../../../shared/dirtyflash'
import { errorText, formatSize } from '../format'
import { ProgressBar } from './Jobs'
import { InfoDot } from '../InfoDot'
import { AppsTab } from './AppsTab'
import { DebloatTab } from './DebloatTab'
import { RecipeTab } from './RecipeTab'

// Unpack or build jobs started from this window, by project path. Survives page switches.
const projectJobs = new Map<string, string>()

/** Android version of the base, read from the system build.prop already in stock.json. */
function systemProps(stock: StockInfo): Record<string, string> {
  return (
    stock.props.find((p) => p.partition === 'system' && p.path === 'system/build.prop')?.props ??
    stock.props.find((p) => p.path.endsWith('system/build.prop'))?.props ??
    {}
  )
}
function androidVersion(stock: StockInfo): string {
  const p = systemProps(stock)
  const release = p['ro.build.version.release'] ?? p['ro.system.build.version.release']
  const sdk = p['ro.build.version.sdk']
  const patch = p['ro.build.version.security_patch']
  if (!release && !sdk) return '?'
  return `${release ?? '?'}${sdk ? ` (API ${sdk})` : ''}${patch ? `, patch ${patch}` : ''}`
}

const ROM_EXTENSIONS = ['tgz', 'gz', 'tar', 'zip', 'bin', 'img']

type Tab = 'partitions' | 'files' | 'props' | 'apks' | 'apps' | 'debloat' | 'recipe' | 'build'

export function ProjectView({
  project,
  jobs,
  onChanged
}: {
  project: ProjectSummary
  jobs: JobState[]
  onChanged: () => void
}): React.JSX.Element {
  const [stock, setStock] = useState<StockInfo | null>(null)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [builds, setBuilds] = useState<BuildInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('partitions')
  const [pendingDebloat, setPendingDebloat] = useState<string[]>([])
  const [pendingMod, setPendingMod] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(projectJobs.get(project.path) ?? null)
  const job = jobs.find((j) => j.id === jobId) ?? null
  const running = job?.status === 'running'

  // Load on mount (the parent remounts this view per project) and again when our unpack or
  // build job finishes.
  const finished = job && job.status !== 'running' ? job.status : null
  useEffect(() => {
    let alive = true
    void Promise.all([
      window.hk.stock.info(project.path),
      window.hk.stock.inventory(project.path),
      window.hk.builds.list(project.path)
    ]).then(([s, inv, b]) => {
      if (!alive) return
      setStock(s)
      setInventory(inv)
      setBuilds(b)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [project.path, finished])

  useEffect(() => {
    if (finished) onChanged()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])
  const reloadBuilds = (): void => {
    void window.hk.builds.list(project.path).then(setBuilds)
  }
  const shownError =
    error ?? (job?.status === 'failed' ? (job.error ?? `${job.kind} failed`) : null)

  const pickFile = async (): Promise<void> => {
    const f = await window.hk.dialog.pickFile('Choose a ROM file', ROM_EXTENSIONS)
    if (f) setInput(f)
  }
  const pickDir = async (): Promise<void> => {
    const d = await window.hk.dialog.pickDir('Choose an extracted fastboot ROM folder')
    if (d) setInput(d)
  }
  const start = async (reset: boolean): Promise<void> => {
    if (!input) return
    setError(null)
    try {
      const id = await window.hk.jobs.start('unpack', {
        projectPath: project.path,
        input,
        reset
      })
      projectJobs.set(project.path, id)
      setJobId(id)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const startBuild = async (verity: VerityMode, verify: boolean, zip: boolean): Promise<void> => {
    setError(null)
    try {
      const id = await window.hk.jobs.start('build', {
        projectPath: project.path,
        verity,
        verify,
        zip
      })
      projectJobs.set(project.path, id)
      setJobId(id)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const chooser = (
    <div className="panel" data-testid="unpack-panel">
      <strong>{stock ? 'Re-unpack from another ROM' : 'Load a stock ROM'}</strong>
      <p className="sub" style={{ margin: '4px 0 10px' }}>
        Fastboot package (.tgz), images zip, OTA zip or payload.bin, an extracted folder, or a
        single super.img. The ROM is read only; partitions are extracted into this project.
      </p>
      <div className="row">
        <button onClick={() => void pickFile()} disabled={running}>
          Choose file…
        </button>
        <button onClick={() => void pickDir()} disabled={running}>
          Choose folder…
        </button>
        <span className="mono" data-testid="unpack-input">
          {input ?? ''}
        </span>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="primary"
          disabled={!input || running}
          onClick={() => {
            if (stock && !window.confirm('Replace the current stock extraction of this project?'))
              return
            void start(!!stock)
          }}
          data-testid="unpack-start"
        >
          {stock ? 'Re-unpack' : 'Unpack'}
        </button>
      </div>
    </div>
  )

  return (
    <div data-testid="project-current">
      <h2 style={{ marginTop: 0 }}>
        {project.meta.name}{' '}
        <span className="mono" style={{ fontWeight: 400 }}>
          {project.path}
        </span>
      </h2>

      {running && job && (
        <div className="panel" data-testid="job-progress">
          <strong>{job.title}</strong>
          <div className="row">
            <ProgressBar job={job} />
            <span>{Math.round((job.progress ?? 0) * 100)}%</span>
            <span className="sub" style={{ margin: 0 }}>
              {job.step}
            </span>
            <button onClick={() => void window.hk.jobs.cancel(job.id)}>Cancel</button>
          </div>
        </div>
      )}
      {shownError && (
        <p className="error-text" data-testid="unpack-error">
          {shownError}
        </p>
      )}

      {loaded && !stock && !running && chooser}

      {stock && (
        <>
          <div className="panel" data-testid="stock-summary">
            <div className="row" style={{ gap: 18 }}>
              <span>
                Device <strong data-testid="stock-device">{stock.device ?? '?'}</strong>
              </span>
              <span>
                Version <strong data-testid="stock-version">{stock.romVersion ?? '?'}</strong>
              </span>
              <span>
                Android <strong data-testid="stock-android">{androidVersion(stock)}</strong>
              </span>
              <span>
                {stock.partitions.filter((p) => p.extracted).length} of {stock.partitions.length}{' '}
                partitions extracted
              </span>
              <span>{inventory?.apks.length ?? 0} APKs</span>
            </div>
            <div className="mono" style={{ marginTop: 6 }}>
              {stock.input.kind}: {stock.input.path}
              {stock.input.sha256 ? ` (sha256 ${stock.input.sha256})` : ''}
            </div>
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            {(
              [
                ['partitions', 'Partitions'],
                ['files', 'Files'],
                ['props', 'build.prop'],
                ['apks', 'APKs'],
                ['apps', 'App editor'],
                ['debloat', 'Debloat'],
                ['recipe', 'Recipe'],
                ['build', 'Build']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? 'primary' : ''}
                onClick={() => setTab(id)}
                data-testid={`tab-${id}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'partitions' && <PartitionsTab stock={stock} />}
          {tab === 'files' && <FilesTab projectPath={project.path} />}
          {tab === 'props' && <PropsTab stock={stock} />}
          {tab === 'apks' && (
            <ApksTab
              apks={inventory?.apks ?? []}
              onDebloat={(pkgs) => {
                setPendingDebloat(pkgs)
                setTab('recipe')
              }}
              onEdit={(target) => {
                setPendingMod(target)
                setTab('apps')
              }}
            />
          )}
          {tab === 'apps' && (
            <AppsTab
              projectPath={project.path}
              apks={inventory?.apks ?? []}
              pendingTarget={pendingMod}
              onTargetConsumed={() => setPendingMod(null)}
            />
          )}
          {tab === 'debloat' && (
            <DebloatTab projectPath={project.path} apks={inventory?.apks ?? []} />
          )}
          {tab === 'recipe' && (
            <RecipeTab
              projectPath={project.path}
              stock={stock}
              apks={inventory?.apks ?? []}
              pendingDebloat={pendingDebloat}
              onDebloatConsumed={() => setPendingDebloat([])}
            />
          )}
          {tab === 'build' && (
            <BuildTab
              projectPath={project.path}
              builds={builds}
              running={running}
              onStart={(v, verify, zip) => void startBuild(v, verify, zip)}
              onReload={reloadBuilds}
            />
          )}
          {!running && tab === 'partitions' && <div style={{ marginTop: 22 }}>{chooser}</div>}
        </>
      )}
    </div>
  )
}

function PartitionsTab({ stock }: { stock: StockInfo }): React.JSX.Element {
  const s = stock.super
  return (
    <>
      <table data-testid="partitions-table">
        <thead>
          <tr>
            <th>Partition</th>
            <th>In super as</th>
            <th>Type</th>
            <th>Size</th>
            <th>Extracted</th>
          </tr>
        </thead>
        <tbody>
          {stock.partitions.map((p) => (
            <tr key={p.name} data-testid={`partition-${p.name}`}>
              <td>{p.name}</td>
              <td className="mono">{p.lpName ?? ''}</td>
              <td>{p.kind}</td>
              <td>{formatSize(p.size)}</td>
              <td>{p.extracted ? 'yes' : (p.note ?? 'no')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s && (
        <div className="panel" style={{ marginTop: 14 }}>
          <strong>Super layout</strong> (read from the stock metadata, reused for repack)
          <div className="mono" style={{ marginTop: 6 }}>
            metadata v{s.version}, max size {s.metadataMaxSize}, slots {s.metadataSlotCount}, block{' '}
            {s.logicalBlockSize}, virtual A/B {s.virtualAb ? 'yes' : 'no'}
            <br />
            {s.blockDevices.map(
              (b) => `device ${b.name}: ${b.size} bytes, alignment ${b.alignment}`
            )}
            <br />
            {s.groups
              .filter((g) => g.maximumSize > 0)
              .map((g) => `group ${g.name}: max ${g.maximumSize}`)
              .join(', ')}
          </div>
        </div>
      )}
      {stock.firmware.length > 0 && (
        <p className="sub" style={{ marginTop: 10 }}>
          {stock.firmware.length} firmware files and flash scripts kept in stock/firmware for the
          flashable output.
        </p>
      )}
    </>
  )
}

function FilesTab({ projectPath }: { projectPath: string }): React.JSX.Element {
  return (
    <div
      className="panel mono"
      data-testid="files-tree"
      style={{ maxHeight: 560, overflow: 'auto' }}
    >
      <DirNode projectPath={projectPath} rel="" depth={0} />
    </div>
  )
}

function DirNode({
  projectPath,
  rel,
  depth
}: {
  projectPath: string
  rel: string
  depth: number
}): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.hk.stock
      .listDir(projectPath, rel)
      .then(setEntries)
      .catch((e) => setError(errorText(e)))
  }, [projectPath, rel])
  if (error) return <div className="error-text">{error}</div>
  if (!entries) return <div className="empty">…</div>
  return (
    <div>
      {entries.map((e) => {
        const childRel = rel ? `${rel}/${e.name}` : e.name
        const isOpen = open.has(e.name)
        return (
          <div key={e.name}>
            <div
              style={{ paddingLeft: depth * 14, cursor: e.type === 'dir' ? 'pointer' : 'default' }}
              onClick={() => {
                if (e.type !== 'dir') return
                const next = new Set(open)
                if (isOpen) next.delete(e.name)
                else next.add(e.name)
                setOpen(next)
              }}
              data-testid={`node-${childRel}`}
            >
              {e.type === 'dir' ? (isOpen ? '▾ ' : '▸ ') : '  '}
              {e.name}
              {e.type === 'symlink' ? ` → ${e.target}` : ''}
              {e.type === 'file' ? <span className="sub"> {formatSize(e.size)}</span> : null}
            </div>
            {isOpen && <DirNode projectPath={projectPath} rel={childRel} depth={depth + 1} />}
          </div>
        )
      })}
    </div>
  )
}

function PropsTab({ stock }: { stock: StockInfo }): React.JSX.Element {
  const [sel, setSel] = useState(0)
  const [filter, setFilter] = useState('')
  const file = stock.props[sel]
  const rows = useMemo(() => {
    if (!file) return []
    const f = filter.toLowerCase()
    return Object.entries(file.props).filter(
      ([k, v]) => !f || k.toLowerCase().includes(f) || v.toLowerCase().includes(f)
    )
  }, [file, filter])
  if (stock.props.length === 0) return <div className="empty">No build.prop found.</div>
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <select
          value={sel}
          onChange={(e) => setSel(Number(e.target.value))}
          data-testid="props-file"
        >
          {stock.props.map((p, i) => (
            <option key={i} value={i}>
              {p.partition}/{p.path}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter keys or values"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="props-filter"
        />
        <span className="sub" style={{ margin: 0 }}>
          {rows.length} properties
        </span>
      </div>
      <table data-testid="props-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="mono">{k}</td>
              <td className="mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

const PAGE_SIZE = 100

const RELATION: Record<ApkUpdateResult['relation'], { label: string; cls: string }> = {
  newer: { label: 'newer available', cls: 'warn' },
  same: { label: 'up to date', cls: 'ok' },
  older: { label: 'ROM is newer', cls: 'ok' },
  unknown: { label: 'unknown', cls: 'cancelled' }
}

function UpdateCell({
  state
}: {
  state: ApkUpdateResult | 'checking' | undefined
}): React.JSX.Element | null {
  if (state === undefined) return null
  if (state === 'checking') return <span className="sub">checking…</span>
  if (!state.latest) {
    return (
      <span className="sub" title={state.note ?? ''}>
        {state.note ?? 'not found'}{' '}
        <a href={state.url} target="_blank" rel="noreferrer">
          open
        </a>
      </span>
    )
  }
  const r = RELATION[state.relation]
  return (
    <span>
      <span className={`badge ${r.cls}`}>{r.label}</span>
      <div className="sub">
        {state.latest}{' '}
        <a href={state.url} target="_blank" rel="noreferrer">
          page
        </a>
      </div>
    </span>
  )
}

function ApksTab({
  apks,
  onDebloat,
  onEdit
}: {
  apks: ApkInfo[]
  onDebloat: (packages: string[]) => void
  onEdit: (treePath: string) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [partition, setPartition] = useState('')
  const [updates, setUpdates] = useState<Record<string, ApkUpdateResult | 'checking'>>({})
  const [page, setPage] = useState(0)
  const checkUpdate = async (pkg: string, version: string | null): Promise<void> => {
    setUpdates((u) => ({ ...u, [pkg]: 'checking' }))
    try {
      const r = await window.hk.apk.updateCheck(pkg, version)
      setUpdates((u) => ({ ...u, [pkg]: r }))
    } catch {
      setUpdates((u) => {
        const n = { ...u }
        delete n[pkg]
        return n
      })
    }
  }
  const partitions = useMemo(() => [...new Set(apks.map((a) => a.partition))].sort(), [apks])
  // Signers by number of APKs: the platform key usually signs most of the system.
  const signers = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of apks)
      if (a.signerSha256) m.set(a.signerSha256, (m.get(a.signerSha256) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [apks])
  const rows = useMemo(() => {
    const f = filter.toLowerCase()
    return apks.filter(
      (a) =>
        (!partition || a.partition === partition) &&
        (!f ||
          a.path.toLowerCase().includes(f) ||
          (a.packageName ?? '').toLowerCase().includes(f) ||
          (a.signerSha256 ?? '').startsWith(f))
    )
  }, [apks, filter, partition])
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <select
          value={partition}
          onChange={(e) => {
            setPartition(e.target.value)
            setPage(0)
          }}
        >
          <option value="">All partitions</option>
          {partitions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by package, path or signer prefix"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setPage(0)
          }}
          data-testid="apks-filter"
        />
        <span className="sub" style={{ margin: 0 }} data-testid="apks-count">
          {rows.length} of {apks.length} APKs
        </span>
        <InfoDot title="Latest (community) column">
          <p>
            &quot;Check&quot; looks the app up on memeosupdates.com, a community tracker (not
            Xiaomi), and compares the version there with the one in your ROM.
          </p>
          <p>
            The tracker may list a different region or variant, and version names are not always
            comparable, so treat it as a hint and open the page to confirm. HyperKitchen only reads
            the page; it never downloads or installs anything.
          </p>
        </InfoDot>
        <button
          disabled={!picked.size}
          onClick={() => onDebloat([...picked])}
          data-testid="apks-debloat"
        >
          Add {picked.size || ''} to debloat
        </button>
      </div>
      <details style={{ marginBottom: 10 }}>
        <summary>{signers.length} distinct signers</summary>
        <table>
          <tbody>
            {signers.map(([s, n]) => (
              <tr key={s}>
                <td className="mono">{s}</td>
                <td>{n} APKs</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <table data-testid="apks-table">
        <thead>
          <tr>
            <th />
            <th>Package</th>
            <th>Version</th>
            <th>Path</th>
            <th>Signer (SHA-256)</th>
            <th>Size</th>
            <th>Latest (community)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((a) => (
            <tr key={`${a.partition}/${a.path}`}>
              <td>
                {a.packageName && (
                  <input
                    type="checkbox"
                    checked={picked.has(a.packageName)}
                    onChange={(e) => {
                      const next = new Set(picked)
                      if (e.target.checked) next.add(a.packageName as string)
                      else next.delete(a.packageName as string)
                      setPicked(next)
                    }}
                  />
                )}
              </td>
              <td className="mono">
                {a.packageName ?? <span className="error-text">{a.error ?? 'unknown'}</span>}
                {a.overlayTarget ? <div className="sub">overlay for {a.overlayTarget}</div> : null}
              </td>
              <td className="mono">
                {a.versionCode ?? ''}
                {a.versionName ? <div className="sub">{a.versionName}</div> : null}
              </td>
              <td className="mono">
                {a.partition}/{a.path}
              </td>
              <td className="mono" title={a.signerSha256 ?? ''}>
                {a.signerSha256 ? `${a.signerSha256.slice(0, 16)}…` : 'unsigned'}
                <div className="sub">{a.schemes.join(' ')}</div>
              </td>
              <td>{formatSize(a.size)}</td>
              <td className="mono">
                {a.packageName && <UpdateCell state={updates[a.packageName]} />}
                {a.packageName && updates[a.packageName] === undefined && (
                  <button onClick={() => void checkUpdate(a.packageName as string, a.versionName)}>
                    Check
                  </button>
                )}
              </td>
              <td>
                {a.size > 0 && !a.error && (
                  <button onClick={() => onEdit(`${a.partition}/${a.path}`)}>Edit</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > PAGE_SIZE && (
        <div className="row" style={{ marginTop: 10 }} data-testid="apks-pager">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            ← Prev
          </button>
          <span className="sub" style={{ margin: 0 }}>
            Page {current + 1} of {pageCount} ({rows.length} apps
            {rows.length !== apks.length ? ` filtered from ${apks.length}` : ''})
          </span>
          <button disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
            Next →
          </button>
        </div>
      )}
    </>
  )
}

function BuildTab({
  projectPath,
  builds,
  running,
  onStart,
  onReload
}: {
  projectPath: string
  builds: BuildInfo[]
  running: boolean
  onStart: (verity: VerityMode, verify: boolean, zip: boolean) => void
  onReload: () => void
}): React.JSX.Element {
  const [verity, setVerity] = useState<VerityMode>('fstab')
  const [verify, setVerify] = useState(true)
  const [zip, setZip] = useState(true)
  return (
    <>
      <div className="panel" data-testid="build-panel">
        <strong>Build a fastboot package</strong>
        <p className="sub" style={{ margin: '4px 0 10px' }}>
          Rebuilds every partition from work/ with the stock erofs settings, packs super.img with
          the stock layout and writes flash scripts you run yourself. The recipe is still empty in
          this version, so the result has the same files as stock: use it as the boot test before
          any modification. The package only boots with an <strong>unlocked</strong> bootloader.
        </p>
        <div style={{ display: 'grid', gap: 6 }}>
          <label>
            <input
              type="radio"
              name="verity"
              checked={verity === 'fstab'}
              onChange={() => setVerity('fstab')}
              data-testid="verity-fstab"
            />{' '}
            <strong>Remove avb flags from the vendor_boot fstab</strong> (default). vbmeta stays
            stock. Same edit global onyx ROMs make.{' '}
            <InfoDot title="Why a verity change is needed at all">
              <p>
                Android Verified Boot (AVB) stores a cryptographic hash tree of each read-only
                partition. At boot, dm-verity checks every block against it and refuses to mount a
                partition that does not match.
              </p>
              <p>
                Rebuilding a partition (new erofs image) changes those hashes, so the stock AVB data
                no longer matches and the device would fail to boot. One of the two options here
                must be used so the rebuilt ROM boots.
              </p>
              <p>
                <strong>This option</strong> removes the <code>avb</code> flags from the first-stage
                mount table (fstab) inside the vendor_boot ramdisk, so dm-verity is never set up for
                those partitions. vbmeta.img is left exactly as Xiaomi signed it. This is the
                lightest-touch change and is byte-for-byte what global onyx ROMs do.
              </p>
            </InfoDot>
          </label>
          <label>
            <input
              type="radio"
              name="verity"
              checked={verity === 'vbmeta-flags'}
              onChange={() => setVerity('vbmeta-flags')}
              data-testid="verity-vbmeta"
            />{' '}
            <strong>Disable verification in vbmeta.img</strong> (flags 3, like fastboot
            --disable-verity --disable-verification). vendor_boot stays stock.{' '}
            <InfoDot title="What disabling vbmeta verification does">
              <p>
                vbmeta.img is the AVB metadata partition: it holds the signed hashes and the
                hashtree descriptors for the other partitions. It has a flags field (AOSP
                avb_vbmeta_image.h, offset 120).
              </p>
              <p>
                This option sets <code>flags = 3</code>: <code>HASHTREE_DISABLED (1)</code> turns
                off dm-verity for every partition, and <code>VERIFICATION_DISABLED (2)</code> turns
                off the signature check of the vbmeta chain. It is exactly what{' '}
                <code>fastboot --disable-verity --disable-verification flash vbmeta</code> writes.
              </p>
              <p>
                Because the flags live inside the signed header, the signature no longer matches.
                libavb only tolerates that on an <strong>unlocked</strong> bootloader, so this (and
                the fstab option) only boots unlocked. Use this when a build also changes a
                partition that the fstab option does not cover; otherwise the fstab option is
                preferred because it leaves vbmeta untouched.
              </p>
            </InfoDot>
          </label>
          <label>
            <input
              type="checkbox"
              checked={verify}
              onChange={(e) => setVerify(e.target.checked)}
              data-testid="build-verify"
            />{' '}
            Verify: extract every rebuilt image again and compare it file by file (slower){' '}
            <InfoDot title="Build verification">
              <p>
                After building each partition, HyperKitchen extracts the new image again and
                compares every file (content, type, size, symlink target, owner, mode, SELinux
                label) against what went in, and reads super.img back to confirm the layout.
              </p>
              <p>
                It roughly doubles build time but proves the repack is faithful. Leave it on unless
                you are iterating quickly and will verify a later build.
              </p>
            </InfoDot>
          </label>
          <label>
            <input
              type="checkbox"
              checked={zip}
              onChange={(e) => setZip(e.target.checked)}
              data-testid="build-zip"
            />{' '}
            One zip like xiaomi.eu: scripts for macOS, Linux and Windows with fastboot included,
            installable from TWRP/OrangeFox too (needs as much free space again as the build){' '}
            <InfoDot title="The xiaomi.eu style zip">
              <p>
                Without this you still get the <code>images/</code> folder and the flash scripts in
                the build folder. With it, HyperKitchen also writes one zip containing everything
                plus a recovery installer, so the same file can be flashed with fastboot scripts or
                sideloaded from TWRP/OrangeFox.
              </p>
              <p>It needs about as much extra free space as the build while it is being made.</p>
            </InfoDot>
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="primary"
            disabled={running}
            onClick={() => onStart(verity, verify, zip)}
            data-testid="build-start"
          >
            Build
          </button>
        </div>
      </div>

      <h2>Builds</h2>
      {builds[0]?.dataFormat && builds[0].dataFormat.level !== 'not-needed' && (
        <div
          className="panel"
          style={{ borderColor: 'var(--warn)' }}
          data-testid="build-format-warning"
        >
          <strong className="error-text">
            ⚠ The latest build ({builds[0].id}) needs a data format
          </strong>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            {builds[0].dataFormat.level === 'first-install'
              ? 'Flash it once with install_and_format_data (you lose apps, settings and internal storage); after that, later builds can be dirty-flashed with install_upgrade.'
              : 'It must be flashed with install_and_format_data on every install.'}{' '}
            Reason: {builds[0].dataFormat.reasons.join('; ')}.
          </p>
        </div>
      )}
      {(() => {
        const done = builds.filter((b) => b.status === 'done')
        if (done.length < 2) return null
        const cmp = compareBuildFlash(done[1], done[0])
        return (
          <div
            className="panel"
            style={{ borderColor: cmp.dirtyFlashable ? 'var(--ok)' : 'var(--warn)' }}
            data-testid="build-flash-compare"
          >
            <strong className={cmp.dirtyFlashable ? '' : 'error-text'}>
              {cmp.dirtyFlashable ? '✓ Dirty-flash OK' : '⚠ Data format needed'}
            </strong>{' '}
            <span className="sub">
              flashing <span className="mono">{done[0].id}</span> over{' '}
              <span className="mono">{done[1].id}</span>
            </span>
            <p className="sub" style={{ margin: '4px 0 0' }}>
              {cmp.dirtyFlashable
                ? 'Same signers and encryption mode as the previous build, so you can flash it and keep data (install_upgrade).'
                : `Flash with install_and_format_data. ${cmp.reasons.join('; ')}.`}
              {!cmp.known &&
                ' A build has no signer fingerprint (made before this check), so this is its own verdict, not a true comparison.'}
            </p>
          </div>
        )
      })()}
      {builds.length === 0 ? (
        <div className="empty">No builds yet.</div>
      ) : (
        builds.map((b) => (
          <div className="panel" key={b.id} data-testid={`build-${b.id}`} data-status={b.status}>
            <div className="row">
              <span className={`badge ${b.status}`}>{b.status}</span>
              <strong className="mono">{b.id}</strong>
              <span className="sub" style={{ margin: 0 }}>
                {b.verity}, {b.partitions.filter((p) => p.treeVerified).length}/
                {b.partitions.length} partitions verified, super.img{' '}
                {b.superVerified ? 'verified' : 'not verified'}
              </span>
              {b.dataFormat && (
                <span
                  className={`badge ${b.dataFormat.level === 'not-needed' ? 'ok' : b.dataFormat.level === 'first-install' ? 'warn' : 'error'}`}
                  title={b.dataFormat.reasons.join('; ')}
                >
                  {b.dataFormat.level === 'not-needed'
                    ? 'dirty flash OK'
                    : b.dataFormat.level === 'first-install'
                      ? 'format on first install'
                      : 'format every install'}
                </span>
              )}
              <button onClick={() => void window.hk.builds.reveal(projectPath, b.id)}>
                Show in folder
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete build ${b.id}? This removes its folder for good.`))
                    return
                  await window.hk.builds.remove(projectPath, b.id)
                  onReload()
                }}
                data-testid={`build-delete-${b.id}`}
              >
                Delete
              </button>
            </div>
            {b.error && <p className="error-text">{b.error}</p>}
            {b.verityChanges.length > 0 && (
              <div className="mono" style={{ marginTop: 6 }}>
                {b.verityChanges.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
            )}
            {b.status === 'done' && (
              <div className="mono" style={{ marginTop: 6 }}>
                {b.zip ? <div>zip: {b.zip}</div> : null}
                <div>
                  recovery installer: {b.recoveryInstaller ? 'yes' : 'no'}, fastboot bundled:{' '}
                  {b.bundledFastboot ? 'yes' : 'no'}
                </div>
                <div>scripts: {b.scripts.join(', ')}</div>
                {b.operations?.length ? (
                  <div>
                    recipe:{' '}
                    {b.operations
                      .map((o) => `${o.id} (-${o.removed.length} ~${o.modified.length})`)
                      .join(', ')}
                  </div>
                ) : null}
              </div>
            )}
            {b.warnings.map((w) => (
              <div key={w} className="error-text">
                {w}
              </div>
            ))}
          </div>
        ))
      )}
    </>
  )
}
