import { useEffect, useMemo, useState } from 'react'
import type { GappsZipInfo, MediaFileInfo, PatchSetInfo } from '../../../shared/ipc'
import {
  mindTheGappsOps,
  purecnImportOps,
  purecnPreset,
  type ImportGroup
} from '../../../shared/presets'
import type { Operation, Recipe } from '../../../shared/recipe'
import type { StockInfo } from '../../../shared/types'
import { errorText, formatSize } from '../format'

const USER_DEBLOAT = 'user-debloat'
const USER_PROPS = 'user-props'
const UNLOCK = 'unlock-cn-gms'
const ENCRYPTION = 'disable-encryption'

function summary(op: Operation): string {
  switch (op.type) {
    case 'debloat':
      return `${op.params.packages.length} packages${op.params.force ? ' (forced, core UIDs)' : ''}`
    case 'remove-paths':
      return op.params.paths.join(', ')
    case 'set-props':
      return `${op.params.file}: ${Object.keys(op.params.set).length} set, ${op.params.remove.length} removed`
    case 'unlock-cn-gms':
      return op.params.includeGnss ? 'product + odm GNSS file' : 'product file'
    case 'patch':
      return op.params.patchSet
    case 'disable-encryption':
      return '/data stored unencrypted'
    case 'gapps':
      return op.params.zip
    case 'app-mod':
      return `mods/${op.params.mod}`
    case 'media':
      return [
        op.params.bootanimation && `boot animation (${op.params.bootanimation.kind})`,
        op.params.wallpaper && 'home wallpaper',
        op.params.lockWallpaper && 'lock wallpaper'
      ]
        .filter(Boolean)
        .join(', ')
    case 'import-from-rom':
      return `${op.params.paths.length} paths from ${op.params.project}${op.params.replace.length ? `, ${op.params.replace.length} replacing stock` : ''}`
  }
}

export function RecipeTab({
  projectPath,
  stock,
  pendingDebloat,
  onDebloatConsumed
}: {
  projectPath: string
  stock: StockInfo
  pendingDebloat: string[]
  onDebloatConsumed: () => void
}): React.JSX.Element {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [catalog, setCatalog] = useState<PatchSetInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [propFile, setPropFile] = useState(
    stock.props[0] ? `${stock.props[0].partition}/${stock.props[0].path}` : ''
  )
  const [propKey, setPropKey] = useState('')
  const [propValue, setPropValue] = useState('')
  const [refProject, setRefProject] = useState<string | null>(null)
  const [groups, setGroups] = useState<ImportGroup[]>(['global-compat', 'gapps'])

  useEffect(() => {
    void Promise.all([window.hk.recipe.get(projectPath), window.hk.recipe.catalog()])
      .then(([r, c]) => {
        setRecipe(r)
        setSaved(JSON.stringify(r))
        setCatalog(c)
      })
      .catch((e) => setError(errorText(e)))
  }, [projectPath])

  // Packages picked in the APKs tab land in the user debloat operation.
  useEffect(() => {
    if (!recipe || !pendingDebloat.length) return
    const cur = recipe.operations.find((o) => o.id === USER_DEBLOAT)
    const pkgs = [
      ...new Set([...(cur?.type === 'debloat' ? cur.params.packages : []), ...pendingDebloat])
    ]
    upsert({
      id: USER_DEBLOAT,
      type: 'debloat',
      enabled: true,
      params: { packages: pkgs, force: false }
    })
    onDebloatConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDebloat, recipe])

  const dirty = useMemo(() => recipe !== null && JSON.stringify(recipe) !== saved, [recipe, saved])
  if (!recipe) return <div className="empty">{error ?? 'Loading recipe…'}</div>

  const ops = recipe.operations
  const set = (next: Operation[]): void => setRecipe({ ...recipe, operations: next })
  function upsert(op: Operation): void {
    if (!recipe) return
    const i = recipe.operations.findIndex((o) => o.id === op.id)
    const next = [...recipe.operations]
    if (i >= 0) next[i] = op
    else next.push(op)
    setRecipe({ ...recipe, operations: next })
  }
  const remove = (id: string): void => set(ops.filter((o) => o.id !== id))
  const find = (id: string): Operation | undefined => ops.find((o) => o.id === id)
  const patchOn = (setId: string): Operation | undefined =>
    ops.find((o) => o.type === 'patch' && o.params.patchSet === setId)

  const save = async (): Promise<void> => {
    setError(null)
    try {
      const r = await window.hk.recipe.save(projectPath, recipe)
      setRecipe(r)
      setSaved(JSON.stringify(r))
    } catch (e) {
      setError(errorText(e))
    }
  }

  const userDebloat = find(USER_DEBLOAT)
  const userProps = find(USER_PROPS)
  const unlock = find(UNLOCK)
  const encryption = find(ENCRYPTION)

  return (
    <>
      <div className="panel" data-testid="recipe-panel">
        <div className="row">
          <strong>Recipe</strong>
          <span className="sub" style={{ margin: 0 }}>
            {ops.filter((o) => o.enabled).length} of {ops.length} operations enabled
            {dirty ? ' (unsaved)' : ''}
          </span>
          <button
            onClick={() => {
              if (
                ops.length &&
                !window.confirm('Replace the current recipe with the PureCN preset?')
              )
                return
              set(purecnPreset())
            }}
            data-testid="preset-purecn"
          >
            Use PureCN preset
          </button>
          <button
            className="primary"
            disabled={!dirty}
            onClick={() => void save()}
            data-testid="recipe-save"
          >
            Save
          </button>
        </div>
        <p className="sub" style={{ margin: '8px 0 0' }}>
          Operations run on a fresh copy of the stock ROM at every build. Changes are not tested on
          a device until you boot the result.
        </p>
        {error && <p className="error-text">{error}</p>}
      </div>

      <h2>Patches (battery, notifications)</h2>
      <div className="panel">
        {catalog
          .filter((p) => p.id !== BRANDING_PATCH)
          .map((p) => {
            const op = patchOn(p.id)
            return (
              <label key={p.id} style={{ display: 'block', marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={!!op?.enabled}
                  onChange={(e) => {
                    if (op) upsert({ ...op, enabled: e.target.checked })
                    else
                      upsert({
                        id: `patch-${p.id}`,
                        type: 'patch',
                        enabled: true,
                        params: { patchSet: p.id }
                      })
                  }}
                  data-testid={`patch-${p.id}`}
                />{' '}
                <strong>{p.title}</strong>
                <div className="sub" style={{ margin: '2px 0 0 22px' }}>
                  {p.description} <span className="mono">({p.targets.join(', ')})</span>
                </div>
              </label>
            )
          })}
      </div>

      <h2>Branding (name, boot animation, wallpapers)</h2>
      <Branding
        prop={find(BRANDING_PROP_OP)}
        patch={patchOn(BRANDING_PATCH)}
        projectPath={projectPath}
        media={ops.find((o) => o.id === MEDIA_OP)}
        onChange={(add, removeIds) =>
          set([
            ...ops.filter((o) => !removeIds.includes(o.id) && !add.some((a) => a.id === o.id)),
            ...add
          ])
        }
      />

      <h2>Import from a reference ROM (PureCN)</h2>
      <div className="panel" data-testid="import-panel">
        <p className="sub" style={{ margin: '0 0 8px' }}>
          Copies files from another unpacked HyperKitchen project on this computer, for example a
          PureCN ROM built on the same base version. Owner, mode and SELinux labels are taken from
          that ROM. Replacing stock files is refused unless both ROMs have the same base version.
          Nothing is downloaded. A first install of a build with Google apps should format data
          (install_and_format_data).
        </p>
        <div className="row">
          <button
            onClick={() =>
              void window.hk.dialog
                .pickDir('Choose the unpacked reference project')
                .then((d) => d && setRefProject(d))
            }
            data-testid="import-pick"
          >
            Choose project…
          </button>
          <span className="mono">{refProject ?? ''}</span>
        </div>
        {(
          [
            [
              'global-compat',
              'Global compatibility: PureCN-patched SystemUI, Settings, AOD, Home, Contacts, TeleService, SecurityCenter, package installer, overlays, device features'
            ],
            [
              'gapps',
              'Google apps: Play Store, Google, Gemini, Gboard, setup wizard, restore, sync adapters, TTS (replaces the CN Play Store stub)'
            ],
            ['global-apps', 'Global Xiaomi apps: Weather, Themes, Health and the style pickers'],
            ['microsoft', 'Link to Windows']
          ] as Array<[ImportGroup, string]>
        ).map(([g, label]) => (
          <label key={g} style={{ display: 'block', marginTop: 6 }}>
            <input
              type="checkbox"
              checked={groups.includes(g)}
              onChange={(e) =>
                setGroups(e.target.checked ? [...groups, g] : groups.filter((x) => x !== g))
              }
              data-testid={`import-${g}`}
            />{' '}
            {label}
          </label>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button
            disabled={!refProject || !groups.length}
            onClick={() => {
              const add = purecnImportOps(refProject as string, groups)
              const ids = new Set(add.map((o) => o.id))
              set([...ops.filter((o) => !ids.has(o.id)), ...add])
            }}
            data-testid="import-add"
          >
            Add to recipe
          </button>
        </div>
        <p className="sub" style={{ margin: '8px 0 0' }}>
          Not imported on purpose: xiaomi.eu components (XiaomiEUExt, xeu_toolbox), the boot-time
          resetprop that reports a locked bootloader, the pm disable tweaks in a vendor rc file,
          branding, wallpapers and themes.
        </p>
      </div>

      <h2>Google services</h2>
      <div className="panel">
        <label>
          <input
            type="checkbox"
            checked={!!unlock?.enabled}
            onChange={(e) =>
              upsert({
                id: UNLOCK,
                type: 'unlock-cn-gms',
                enabled: e.target.checked,
                params: {
                  includeGnss: unlock?.type === 'unlock-cn-gms' ? unlock.params.includeGnss : false
                }
              })
            }
            data-testid="unlock-cn-gms"
          />{' '}
          Remove the CN Google services restriction (cn.google.services feature)
        </label>
        {unlock?.type === 'unlock-cn-gms' && (
          <label style={{ display: 'block', marginLeft: 22 }}>
            <input
              type="checkbox"
              checked={unlock.params.includeGnss}
              onChange={(e) => upsert({ ...unlock, params: { includeGnss: e.target.checked } })}
            />{' '}
            Also in odm/etc/permissions/com.gnss.bds_preference.xml (PureCN does, xiaomi.eu does
            not; the file selects BeiDou preference for GNSS)
          </label>
        )}
      </div>

      <h2>GApps from MindTheGapps</h2>
      <MindTheGapps
        current={recipe.operations.find((o) => o.type === 'gapps') ?? null}
        onApply={(add) => set([...ops.filter((o) => !add.some((a) => a.id === o.id)), ...add])}
        onRemove={() => set(recipe.operations.filter((o) => o.type !== 'gapps'))}
      />

      <h2>Debloat</h2>
      <div className="panel">
        <p className="sub" style={{ margin: '0 0 6px' }}>
          One package per line. Tick apps in the APKs tab to add them here. Core system packages are
          refused unless an operation is forced.
        </p>
        <textarea
          className="mono"
          rows={6}
          style={{ width: '100%' }}
          value={userDebloat?.type === 'debloat' ? userDebloat.params.packages.join('\n') : ''}
          onChange={(e) => {
            const pkgs = e.target.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
            if (!pkgs.length) remove(USER_DEBLOAT)
            else
              upsert({
                id: USER_DEBLOAT,
                type: 'debloat',
                enabled: true,
                params: { packages: pkgs, force: false }
              })
          }}
          data-testid="debloat-list"
        />
      </div>

      <h2>build.prop</h2>
      <div className="panel">
        <div className="row">
          <select value={propFile} onChange={(e) => setPropFile(e.target.value)}>
            {stock.props.map((p) => (
              <option key={`${p.partition}/${p.path}`} value={`${p.partition}/${p.path}`}>
                {p.partition}/{p.path}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="key"
            value={propKey}
            onChange={(e) => setPropKey(e.target.value)}
            style={{ minWidth: 200 }}
          />
          <input
            type="text"
            placeholder="value"
            value={propValue}
            onChange={(e) => setPropValue(e.target.value)}
            style={{ minWidth: 160 }}
          />
          <button
            disabled={!propKey.trim() || !propFile}
            onClick={() => {
              const cur =
                userProps?.type === 'set-props' && userProps.params.file === propFile
                  ? userProps.params
                  : null
              upsert({
                id: USER_PROPS,
                type: 'set-props',
                enabled: true,
                params: {
                  file: propFile,
                  set: { ...(cur?.set ?? {}), [propKey.trim()]: propValue },
                  remove: cur?.remove ?? []
                }
              })
              setPropKey('')
              setPropValue('')
            }}
          >
            Set
          </button>
        </div>
        {userProps?.type === 'set-props' && (
          <div className="mono" style={{ marginTop: 8 }}>
            {userProps.params.file}:{' '}
            {Object.entries(userProps.params.set)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}
          </div>
        )}
      </div>

      <h2>Encryption</h2>
      <div className="panel">
        <label>
          <input
            type="checkbox"
            checked={!!encryption?.enabled}
            onChange={(e) => {
              if (e.target.checked) {
                const ok = window.confirm(
                  'Disable /data encryption like PureCN?\n\nYour apps, accounts and files will be stored UNENCRYPTED: anyone with the phone and a computer can read them. The device has to be formatted (flash_all.sh wipes data). Stock and xiaomi.eu keep encryption on.'
                )
                if (!ok) return
                upsert({
                  id: ENCRYPTION,
                  type: 'disable-encryption',
                  enabled: true,
                  params: { acknowledged: true }
                })
              } else remove(ENCRYPTION)
            }}
            data-testid="disable-encryption"
          />{' '}
          Disable /data encryption (PureCN). Off by default: stock and xiaomi.eu keep it.
        </label>
      </div>

      <h2>All operations</h2>
      <table data-testid="recipe-ops">
        <thead>
          <tr>
            <th>On</th>
            <th>Id</th>
            <th>Type</th>
            <th>Details</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ops.map((o) => (
            <tr key={o.id}>
              <td>
                <input
                  type="checkbox"
                  checked={o.enabled}
                  onChange={(e) => upsert({ ...o, enabled: e.target.checked })}
                />
              </td>
              <td className="mono">{o.id}</td>
              <td>{o.type}</td>
              <td className="mono">{summary(o)}</td>
              <td>
                <button onClick={() => remove(o.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

const BRANDING_PATCH = 'branding-about'
const BRANDING_PROP_OP = 'branding-prop'
const BRAND_PROP = 'ro.hyperkitchen.rom.display'

const MEDIA_OP = 'branding-media'
type MediaOp = Extract<Operation, { type: 'media' }>
type MediaKey = 'bootanimation' | 'wallpaper' | 'lockWallpaper'

function Branding({
  projectPath,
  prop,
  patch,
  media,
  onChange
}: {
  projectPath: string
  prop: Operation | undefined
  patch: Operation | undefined
  media: Operation | undefined
  onChange: (add: Operation[], removeIds: string[]) => void
}): React.JSX.Element {
  const mediaParams = media?.type === 'media' ? media.params : {}
  const setMedia = (key: MediaKey, value: MediaOp['params'][MediaKey] | undefined): void => {
    const params = { ...mediaParams, [key]: value }
    if (!value) delete params[key]
    if (!params.bootanimation && !params.wallpaper && !params.lockWallpaper) {
      onChange([], [MEDIA_OP])
      return
    }
    onChange([{ id: MEDIA_OP, type: 'media', enabled: true, params } as MediaOp], [])
  }
  const current = prop?.type === 'set-props' ? (prop.params.set[BRAND_PROP] ?? '') : ''
  const [name, setName] = useState(current)
  const on = !!patch?.enabled && !!prop?.enabled
  return (
    <div className="panel" data-testid="branding-panel">
      <p className="sub" style={{ margin: '0 0 8px' }}>
        Shows &quot;&lt;HyperOS version&gt; | &lt;name&gt;&quot; on the About phone version card and
        the device details page. The name is the {BRAND_PROP} prop in product/etc/build.prop;
        Settings gets a small helper class and two calls to it (patch set {BRANDING_PATCH}, keeps
        the stock signature). The version strings other code parses are not changed.
      </p>
      <div className="row">
        <input
          type="text"
          placeholder="ROM name, e.g. HyperKitchen 1.0"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          data-testid="branding-name"
        />
        <button
          className="primary"
          disabled={!name.trim() || /[\n=]/.test(name)}
          onClick={() =>
            onChange(
              [
                {
                  id: BRANDING_PROP_OP,
                  type: 'set-props',
                  enabled: true,
                  params: {
                    file: 'product/etc/build.prop',
                    set: { [BRAND_PROP]: name.trim() },
                    remove: []
                  }
                },
                {
                  id: patch?.id ?? `patch-${BRANDING_PATCH}`,
                  type: 'patch',
                  enabled: true,
                  params: { patchSet: BRANDING_PATCH }
                }
              ],
              []
            )
          }
          data-testid="branding-apply"
        >
          {on ? 'Update' : 'Add'}
        </button>
        {(prop || patch) && (
          <button onClick={() => onChange([], [BRANDING_PROP_OP, ...(patch ? [patch.id] : [])])}>
            Remove
          </button>
        )}
      </div>
      <MediaPicker
        title="Boot animation"
        hint="A bootanimation.zip (checked against the AOSP format; compressed entries are stored), or one logo image shown centred until boot completes."
        extensions={['zip', 'png', 'jpg', 'jpeg', 'webp']}
        projectPath={projectPath}
        current={mediaParams.bootanimation?.file}
        withBackground
        onPick={(info, background) =>
          setMedia('bootanimation', {
            file: info.path,
            sha256: info.sha256,
            kind: info.bootanimation ? 'zip' : 'image',
            background
          })
        }
        onRemove={() => setMedia('bootanimation', undefined)}
      />
      <MediaPicker
        title="Home wallpaper"
        hint="PNG or JPEG for every product/media/wallpaper/wallpaper_<colour>.jpg (stock: PNG, 1280x2772)."
        extensions={['png', 'jpg', 'jpeg']}
        projectPath={projectPath}
        current={mediaParams.wallpaper?.file}
        onPick={(info) => setMedia('wallpaper', { file: info.path, sha256: info.sha256 })}
        onRemove={() => setMedia('wallpaper', undefined)}
      />
      <MediaPicker
        title="Lock screen wallpaper"
        hint="PNG for product/media/theme/default/lock_wallpaper (stock: PNG, 1280x2772)."
        extensions={['png']}
        projectPath={projectPath}
        current={mediaParams.lockWallpaper?.file}
        onPick={(info) => setMedia('lockWallpaper', { file: info.path, sha256: info.sha256 })}
        onRemove={() => setMedia('lockWallpaper', undefined)}
      />
      <p className="sub" style={{ margin: '8px 0 0' }}>
        A theme you apply later on the phone can override these; the files here are the ROM
        defaults.
      </p>
    </div>
  )
}

function MediaPicker({
  title,
  hint,
  extensions,
  projectPath,
  current,
  withBackground,
  onPick,
  onRemove
}: {
  title: string
  hint: string
  extensions: string[]
  projectPath: string
  current: string | undefined
  withBackground?: boolean
  onPick: (info: MediaFileInfo, background: string) => void
  onRemove: () => void
}): React.JSX.Element {
  const [info, setInfo] = useState<MediaFileInfo | null>(null)
  const [background, setBackground] = useState('#000000')
  const [error, setError] = useState<string | null>(null)
  const pick = async (): Promise<void> => {
    const f = await window.hk.dialog.pickFile(`Choose: ${title}`, extensions)
    if (!f) return
    setError(null)
    try {
      setInfo(await window.hk.recipe.inspectMedia(projectPath, f))
    } catch (e) {
      setError(errorText(e))
    }
  }
  const ba = info?.bootanimation
  const usable = info && (ba ? ba.problems.length === 0 : info.image !== null)
  return (
    <div style={{ marginTop: 12 }} data-testid={`media-${title}`}>
      <div className="row">
        <strong>{title}</strong>
        {current ? (
          <span className="mono">
            {current} <button onClick={onRemove}>Remove</button>
          </span>
        ) : (
          <span className="sub" style={{ margin: 0 }}>
            stock
          </span>
        )}
        <button onClick={() => void pick()}>Choose…</button>
      </div>
      <div className="sub" style={{ margin: '2px 0 0' }}>
        {hint}
      </div>
      {error && <p className="error-text">{error}</p>}
      {info && (
        <div className="log" style={{ marginTop: 6 }}>
          <div>
            {info.path} ({formatSize(info.size)})
          </div>
          {info.image && (
            <div>
              {info.image.type.toUpperCase()} {info.image.width}x{info.image.height}
            </div>
          )}
          {ba?.desc && (
            <div>
              {ba.desc.width}x{ba.desc.height} at {ba.desc.fps} fps, {ba.desc.parts.length} parts,{' '}
              {ba.frames} frames
            </div>
          )}
          {ba?.problems.map((p) => (
            <div key={p} className="error-text">
              {p}
            </div>
          ))}
          {ba?.warnings.map((w) => (
            <div key={w} className="stderr">
              {w}
            </div>
          ))}
          {!ba && !info.image && <div className="error-text">Not a supported image.</div>}
          {withBackground && !ba && info.image && (
            <label style={{ display: 'block' }}>
              Background{' '}
              <input
                type="text"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                style={{ minWidth: 0, width: 100 }}
              />
            </label>
          )}
          <button
            disabled={!usable || (withBackground && !ba && !/^#[0-9a-fA-F]{6}$/.test(background))}
            onClick={() => {
              onPick(info, background)
              setInfo(null)
            }}
            style={{ marginTop: 6 }}
          >
            Use this file
          </button>
        </div>
      )}
    </div>
  )
}

const GAPPS_DEFAULT_EXCLUDE = ['VelvetTitan', 'SetupWizard', 'GmsSetupWizardOverlay.apk']
const GAPPS_NOTES: Record<string, string> = {
  VelvetTitan: 'Google app for the Pixel Tablet only',
  SetupWizard: 'MindTheGapps deletes Provision for it; HyperOS needs Provision',
  'GmsSetupWizardOverlay.apk': 'targets the LineageOS setup wizard, absent in HyperOS'
}

function MindTheGapps({
  current,
  onApply,
  onRemove
}: {
  current: Operation | null
  onApply: (ops: Operation[]) => void
  onRemove: () => void
}): React.JSX.Element {
  const [info, setInfo] = useState<GappsZipInfo | null>(null)
  const [exclude, setExclude] = useState<string[]>(GAPPS_DEFAULT_EXCLUDE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pick = async (): Promise<void> => {
    const z = await window.hk.dialog.pickFile('Choose a MindTheGapps zip', ['zip'])
    if (!z) return
    setBusy(true)
    setError(null)
    try {
      setInfo(await window.hk.recipe.inspectGapps(z))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="panel" data-testid="gapps-panel">
      <p className="sub" style={{ margin: '0 0 8px' }}>
        Download the MindTheGapps zip for this ROM&apos;s Android version yourself
        (github.com/MindTheGapps); HyperKitchen does not download it. Apps the ROM already has with
        the same signer and an equal or newer version (GmsCore, GSF on CN bases) stay; the CN Play
        Store stub is replaced by Play Store, which needs a data format on first install. The build
        stops if a privileged permission is missing from the allowlists, because the phone would not
        boot.
      </p>
      {current?.type === 'gapps' && (
        <p className="mono" data-testid="gapps-current">
          In the recipe: {current.params.zip}
          {current.params.sha256 ? ` (sha256 ${current.params.sha256.slice(0, 16)}…)` : ''},
          excluded: {current.params.exclude.join(', ') || 'none'}{' '}
          <button onClick={onRemove}>Remove</button>
        </p>
      )}
      <div className="row">
        <button disabled={busy} onClick={() => void pick()} data-testid="gapps-pick">
          {busy ? 'Reading…' : 'Choose zip…'}
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>
      {info && (
        <>
          <p className="mono" style={{ margin: '8px 0' }}>
            {info.path}: Android SDK {info.version}, {info.arch}, sha256 {info.sha256}
          </p>
          <table>
            <tbody>
              {info.units.map((u) => (
                <tr key={u.tree}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!exclude.includes(u.name)}
                      onChange={(e) =>
                        setExclude(
                          e.target.checked
                            ? exclude.filter((x) => x !== u.name)
                            : [...exclude, u.name]
                        )
                      }
                    />
                  </td>
                  <td className="mono">{u.tree}</td>
                  <td>{formatSize(u.bytes)}</td>
                  <td className="sub">{GAPPS_NOTES[u.name] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="primary"
            style={{ marginTop: 8 }}
            onClick={() => onApply(mindTheGappsOps(info.path, info.sha256, exclude))}
            data-testid="gapps-apply"
          >
            Use this zip
          </button>
        </>
      )}
    </div>
  )
}
