import { useEffect, useMemo, useState } from 'react'
import type { GappsZipInfo, MediaFileInfo, PatchSetInfo } from '../../../shared/ipc'
import { mindTheGappsOps, TEMPLATES } from '../../../shared/presets'
import { RecipeSchema, type Operation, type Recipe } from '../../../shared/recipe'
import type { ApkInfo, Material, StockInfo } from '../../../shared/types'
import { errorText, formatSize } from '../format'
import { InfoDot } from '../InfoDot'

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
    case 'spec-card':
      return `${op.params.entries.length} region entries`
    case 'device-feature':
      return [...Object.keys(op.params.bools), ...Object.keys(op.params.ints)].join(', ')
    case 'app-replace':
      return `${op.params.target} <- external APK`
    case 'add-app':
      return `add ${op.params.target}`
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
  apks,
  pendingDebloat,
  onDebloatConsumed
}: {
  projectPath: string
  stock: StockInfo
  apks: ApkInfo[]
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
  const [materials, setMaterials] = useState<Material[]>([])
  const [romLocales, setRomLocales] = useState<string[]>([])

  useEffect(() => {
    void Promise.all([
      window.hk.recipe.get(projectPath),
      window.hk.recipe.catalog(),
      window.hk.materials.list(),
      window.hk.stock.locales(projectPath)
    ])
      .then(([r, c, m, loc]) => {
        setRecipe(r)
        setSaved(JSON.stringify(r))
        setCatalog(c)
        setMaterials(m)
        setRomLocales(loc)
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

  const localeFile = (() => {
    const hit = stock.props.find((x) => x.props['ro.product.locale'])
    return hit ? `${hit.partition}/${hit.path}` : 'system/system/build.prop'
  })()
  const baseSdk = (() => {
    const p =
      stock.props.find((x) => x.partition === 'system' && x.path === 'system/build.prop')?.props ??
      {}
    const n = Number(p['ro.build.version.sdk'])
    return Number.isFinite(n) ? n : null
  })()
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
  const moveOp = (id: string, dir: -1 | 1): void => {
    const i = ops.findIndex((o) => o.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ops.length) return
    const next = [...ops]
    ;[next[i], next[j]] = [next[j], next[i]]
    set(next)
  }
  const find = (id: string): Operation | undefined => ops.find((o) => o.id === id)
  const patchOn = (setId: string): Operation | undefined =>
    ops.find((o) => o.type === 'patch' && o.params.patchSet === setId)

  const exportRecipe = async (): Promise<void> => {
    const dest = await window.hk.dialog.saveFile('Export recipe', 'recipe.json', ['json'])
    if (!dest) return
    try {
      if (dirty) await window.hk.recipe.save(projectPath, recipe)
      await window.hk.recipe.export(projectPath, dest)
    } catch (e) {
      setError(errorText(e))
    }
  }
  const importRecipe = async (): Promise<void> => {
    const src = await window.hk.dialog.pickFile('Import recipe', ['json'])
    if (!src) return
    if (ops.length && !window.confirm('Replace the current recipe with the imported one?')) return
    try {
      const imported = await window.hk.recipe.import(projectPath, src)
      setRecipe(imported)
      setSaved(JSON.stringify(imported))
    } catch (e) {
      setError(errorText(e))
    }
  }
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

  // Live summary of what this recipe will do, shown in the sticky header.
  const enabled = ops.filter((o) => o.enabled)
  const shortName = (p: string): string =>
    p
      .split('/')
      .pop()
      ?.replace(/\.(apk|jar)$/, '') ?? p
  const patched = [
    ...new Set(
      enabled
        .filter((o): o is Extract<Operation, { type: 'patch' }> => o.type === 'patch')
        .flatMap((o) => catalog.find((c) => c.id === o.params.patchSet)?.targets ?? [])
        .map(shortName)
    )
  ]
  const gappsOn = enabled.some((o) => o.type === 'gapps')
  const signerChange = enabled.some((o) => o.type === 'gapps' && o.params.replaceDifferentSigner)
  const encryptionOff = enabled.some((o) => o.type === 'disable-encryption')
  const localeNow = enabled.find((o) => o.id === SET_LOCALE)
  const recipeSummary = {
    patched,
    removed: enabled.reduce(
      (n, o) =>
        n +
        (o.type === 'debloat'
          ? o.params.packages.length
          : o.type === 'remove-paths'
            ? o.params.paths.length
            : 0),
      0
    ),
    gapps: gappsOn,
    imported: enabled
      .filter(
        (o): o is Extract<Operation, { type: 'import-from-rom' }> => o.type === 'import-from-rom'
      )
      .reduce((n, o) => n + o.params.paths.length, 0),
    replaced: enabled.filter((o) => o.type === 'app-replace').length,
    language:
      localeNow?.type === 'set-props' ? (localeNow.params.set['ro.product.locale'] ?? null) : null,
    dirtyFlash: encryptionOff || signerChange ? 'format' : 'ok',
    dirtyReason: encryptionOff
      ? 'encryption is off: /data must be formatted once when you adopt this build'
      : signerChange
        ? 'the Play Store stub is replaced by one signed differently: format once on first install'
        : 'no operation forces a data format'
  }

  // A short status chip for each collapsible section.
  const sectionChip = (id: string): string | null => {
    switch (id) {
      case 'system': {
        const n = enabled.filter((o) =>
          [
            'set-default-locale',
            'disable-ota',
            'disable-analytics',
            'disable-getapps-ads'
          ].includes(o.id)
        ).length
        return n ? `${n} on` : null
      }
      case 'patches': {
        const n = enabled.filter(
          (o) => o.type === 'patch' && o.id !== BRANDING_PATCH && o.id !== `patch-${BRANDING_PATCH}`
        ).length
        return n ? `${n} on` : null
      }
      case 'branding': {
        const n = [BRANDING_PROP_OP, `patch-${BRANDING_PATCH}`, MEDIA_OP, SPEC_CARD_OP].filter(
          (id2) => enabled.some((o) => o.id === id2)
        ).length
        return n ? `${n} on` : null
      }
      case 'google':
        return enabled.some((o) => o.type === 'unlock-cn-gms') ? 'on' : null
      case 'appreplace': {
        const n = enabled.filter((o) => o.type === 'app-replace').length
        return n ? `${n}` : null
      }
      case 'gapps':
        return gappsOn ? 'on' : null
      case 'import':
        return recipeSummary.imported ? `${recipeSummary.imported} paths` : null
      case 'debloat':
        return userDebloat?.type === 'debloat' ? `${userDebloat.params.packages.length} pkg` : null
      case 'encryption':
        return encryptionOff ? 'off' : null
      case 'flagship': {
        const n = enabled.filter((o) => o.id.startsWith('flagship-')).length
        return n ? `${n} on` : null
      }
      case 'operations':
        return `${enabled.length}/${ops.length}`
      default:
        return null
    }
  }

  return (
    <>
      <div className="panel recipe-sticky" data-testid="recipe-panel">
        <div className="row">
          <strong>Recipe</strong>
          <span className="sub" style={{ margin: 0 }}>
            {ops.filter((o) => o.enabled).length} of {ops.length} operations enabled
            {dirty ? ' (unsaved)' : ''}
          </span>
          <button onClick={() => void exportRecipe()} data-testid="recipe-export">
            Export…
          </button>
          <button onClick={() => void importRecipe()} data-testid="recipe-import">
            Import…
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
        <div className="recipe-summary" data-testid="recipe-summary">
          <span>
            <strong>{recipeSummary.patched.length}</strong> apps patched
            {recipeSummary.patched.length ? ` (${recipeSummary.patched.join(', ')})` : ''}
          </span>
          <span>
            <strong>{recipeSummary.removed}</strong> removed
          </span>
          {recipeSummary.gapps && <span className="badge ok">GApps</span>}
          {recipeSummary.imported > 0 && <span>{recipeSummary.imported} imported</span>}
          {recipeSummary.replaced > 0 && <span>{recipeSummary.replaced} app replaced</span>}
          {recipeSummary.language && (
            <span>
              language <strong>{recipeSummary.language}</strong>
            </span>
          )}
          <span
            className={`badge ${recipeSummary.dirtyFlash === 'ok' ? 'ok' : 'warn'}`}
            title={recipeSummary.dirtyReason}
          >
            {recipeSummary.dirtyFlash === 'ok' ? 'dirty-flash OK' : 'format on first install'}
          </span>
        </div>
        <p className="sub" style={{ margin: '8px 0 0' }}>
          Operations run on a fresh copy of the stock ROM at every build. Changes are not tested on
          a device until you boot the result.
        </p>
        {error && <p className="error-text">{error}</p>}
      </div>

      <Section
        id="templates"
        title={'Templates'}
        chip={sectionChip('templates')}
        defaultOpen={false}
      >
        <div className="panel" data-testid="templates-panel">
          <p className="sub" style={{ margin: '0 0 8px' }}>
            A template fills the recipe with a ready-made set of operations. You can then add,
            remove or disable anything before building.
          </p>
          {TEMPLATES.map((t) => (
            <div key={t.id} style={{ marginBottom: 10 }}>
              <div className="row">
                <strong>{t.title}</strong>
                <button
                  onClick={() => {
                    const name =
                      t.id === 'cn-to-global-daily'
                        ? (window.prompt('ROM name for About phone (leave blank to skip):', '') ??
                          '')
                        : ''
                    if (
                      ops.length &&
                      !window.confirm(`Replace the current recipe with "${t.title}"?`)
                    )
                      return
                    set(t.build({ romName: name }))
                  }}
                  data-testid={`template-${t.id}`}
                >
                  Use this template
                </button>
              </div>
              <div className="sub" style={{ margin: '2px 0 0' }}>
                {t.description}
              </div>
              <ul className="sub" style={{ margin: '4px 0 0 18px' }}>
                {t.followUp.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
      <Section
        id="system"
        title={'System defaults and tweaks'}
        chip={sectionChip('system')}
        defaultOpen={true}
      >
        <SystemTweaks
          ops={ops}
          localeFile={localeFile}
          supportedLocales={romLocales}
          onChange={(add, removeIds) =>
            set([
              ...ops.filter((o) => !removeIds.includes(o.id) && !add.some((a) => a.id === o.id)),
              ...add
            ])
          }
        />
      </Section>
      <Section
        id="patches"
        title={'Patches (battery, notifications)'}
        chip={sectionChip('patches')}
        defaultOpen={false}
      >
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
      </Section>
      <Section
        id="flagship"
        title={'Flagship features (optional)'}
        chip={sectionChip('flagship')}
        defaultOpen={false}
      >
        <FlagshipFeatures
          ops={ops}
          device={stock.device}
          onChange={(add, removeIds) =>
            set([
              ...ops.filter((o) => !removeIds.includes(o.id) && !add.some((a) => a.id === o.id)),
              ...add
            ])
          }
        />
      </Section>
      <Section
        id="branding"
        title={'Branding (name, boot animation, wallpapers)'}
        chip={sectionChip('branding')}
        defaultOpen={false}
      >
        <Branding
          prop={find(BRANDING_PROP_OP)}
          patch={patchOn(BRANDING_PATCH)}
          projectPath={projectPath}
          media={ops.find((o) => o.id === MEDIA_OP)}
          specCard={ops.find((o) => o.id === SPEC_CARD_OP)}
          refMaterials={materials.filter((m) => m.kind === 'reference-rom')}
          onChange={(add, removeIds) =>
            set([
              ...ops.filter((o) => !removeIds.includes(o.id) && !add.some((a) => a.id === o.id)),
              ...add
            ])
          }
        />
      </Section>
      <Section
        id="google"
        title={'Google services'}
        chip={sectionChip('google')}
        defaultOpen={false}
      >
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
                    includeGnss:
                      unlock?.type === 'unlock-cn-gms' ? unlock.params.includeGnss : false
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
              Also in odm/etc/permissions/com.gnss.bds_preference.xml (global ROMs do, xiaomi.eu
              does not; the file selects BeiDou preference for GNSS)
            </label>
          )}
        </div>
      </Section>
      <Section
        id="appreplace"
        title={'Replace or add an app (external APK)'}
        chip={sectionChip('appreplace')}
        defaultOpen={false}
      >
        <AppReplace
          apks={apks}
          baseSdk={baseSdk}
          materials={materials.filter((m) => m.kind === 'app')}
          ops={ops.filter((o) => o.type === 'app-replace')}
          onAdd={(op) => set([...ops, op])}
          onRemove={(id) => remove(id)}
        />
      </Section>
      <Section
        id="gapps"
        title={'GApps from MindTheGapps'}
        chip={sectionChip('gapps')}
        defaultOpen={false}
      >
        <MindTheGapps
          gappsMaterials={materials.filter((m) => m.kind === 'gapps')}
          current={recipe.operations.find((o) => o.type === 'gapps') ?? null}
          onApply={(add) => set([...ops.filter((o) => !add.some((a) => a.id === o.id)), ...add])}
          onRemove={() => set(recipe.operations.filter((o) => o.type !== 'gapps'))}
        />
      </Section>
      <Section id="debloat" title={'Debloat'} chip={sectionChip('debloat')} defaultOpen={false}>
        <div className="panel">
          <p className="sub" style={{ margin: '0 0 6px' }}>
            One package per line. Tick apps in the APKs tab to add them here. Core system packages
            are refused unless an operation is forced.
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
      </Section>
      <Section
        id="buildprop"
        title={'build.prop'}
        chip={sectionChip('buildprop')}
        defaultOpen={false}
      >
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
      </Section>
      <Section
        id="encryption"
        title={'Encryption'}
        chip={sectionChip('encryption')}
        defaultOpen={false}
      >
        <div className="panel">
          <label>
            <input
              type="checkbox"
              checked={!!encryption?.enabled}
              onChange={(e) => {
                if (e.target.checked) {
                  const ok = window.confirm(
                    'Disable /data encryption?\n\nYour apps, accounts and files will be stored UNENCRYPTED: anyone with the phone and a computer can read them. The device has to be formatted (flash_all.sh wipes data). Stock and xiaomi.eu keep encryption on.'
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
            Disable /data encryption. Off by default: stock and xiaomi.eu keep it.
          </label>
        </div>
      </Section>
      <Section
        id="operations"
        title={'All operations'}
        chip={sectionChip('operations')}
        defaultOpen={false}
      >
        <table data-testid="recipe-ops">
          <thead>
            <tr>
              <th>On</th>
              <th>Id</th>
              <th>Type</th>
              <th>Details</th>
              <th>Order</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ops.map((o, i) => (
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
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    disabled={i === 0}
                    title="Move up"
                    onClick={() => moveOp(o.id, -1)}
                    data-testid={`op-up-${o.id}`}
                  >
                    ↑
                  </button>{' '}
                  <button
                    disabled={i === ops.length - 1}
                    title="Move down"
                    onClick={() => moveOp(o.id, 1)}
                    data-testid={`op-down-${o.id}`}
                  >
                    ↓
                  </button>
                </td>
                <td>
                  <button onClick={() => remove(o.id)}>Remove</button>
                </td>
              </tr>
            ))}
            {!ops.length && (
              <tr>
                <td colSpan={6} className="empty">
                  No operations. Use a template above, or add one in the sections, or edit the JSON
                  below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="sub" style={{ margin: '6px 0 0' }}>
          File operations (debloat, imports, GApps, media, props) run top to bottom; smali patches
          and app mods run after them. Order matters when one operation depends on another.
        </p>
        <RawEditor recipe={recipe} onApply={(r) => setRecipe(r)} />{' '}
      </Section>
    </>
  )
}

function RawEditor({
  recipe,
  onApply
}: {
  recipe: Recipe
  onApply: (r: Recipe) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Load the current recipe into the box each time it is opened.
  const openEditor = (): void => {
    setText(JSON.stringify(recipe, null, 2))
    setError(null)
    setOpen(true)
  }
  const apply = (): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setError(`not valid JSON: ${(e as Error).message}`)
      return
    }
    const result = RecipeSchema.safeParse(parsed)
    if (!result.success) {
      const first = result.error.issues[0]
      setError(`invalid recipe: ${first.path.join('.') || '(root)'}: ${first.message}`)
      return
    }
    const ids = result.data.operations.map((o) => o.id)
    if (new Set(ids).size !== ids.length) {
      setError('operation ids must be unique')
      return
    }
    setError(null)
    setOpen(false)
    onApply(result.data)
  }
  return (
    <div style={{ marginTop: 14 }}>
      {!open ? (
        <button onClick={openEditor} data-testid="recipe-edit-json">
          Edit recipe as JSON
        </button>
      ) : (
        <div className="panel">
          <div className="row" style={{ marginBottom: 6 }}>
            <strong>Edit recipe as JSON</strong>
            <span className="sub" style={{ margin: 0 }}>
              Changes apply to the editor; use Save above to write recipe.json.
            </span>
          </div>
          <textarea
            className="mono"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ width: '100%', height: 360, whiteSpace: 'pre' }}
            data-testid="recipe-json"
          />
          {error && <p className="error-text">{error}</p>}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="primary" onClick={apply} data-testid="recipe-json-apply">
              Apply
            </button>
            <button onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
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
  specCard,
  refMaterials,
  onChange
}: {
  projectPath: string
  prop: Operation | undefined
  patch: Operation | undefined
  media: Operation | undefined
  specCard: Operation | undefined
  refMaterials: Material[]
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
      <SpecCard
        op={specCard}
        refMaterials={refMaterials}
        onChange={(op) => (op ? onChange([op], []) : onChange([], [SPEC_CARD_OP]))}
      />
      <p className="sub" style={{ margin: '8px 0 0' }}>
        A theme you apply later on the phone can override these; the files here are the ROM
        defaults.
      </p>
    </div>
  )
}

const SPEC_CARD_OP = 'spec-card'
type SpecOp = Extract<Operation, { type: 'spec-card' }>
type SpecEntry = SpecOp['params']['entries'][number]
const BASIC_FIELDS: Array<[string, string]> = [
  ['cpu', 'Processor'],
  ['battery', 'Battery'],
  ['screen', 'Screen'],
  ['resolution', 'Resolution'],
  ['camera', 'Camera (summary)']
]
const CAMERA_FIELDS: Array<[string, string]> = [
  ['rear_camera', 'Rear camera'],
  ['front_camera', 'Front camera']
]

function emptyEntry(): SpecEntry {
  return { hwc: 'GL', basic: {}, camera: {} }
}

function SpecCard({
  op,
  refMaterials,
  onChange
}: {
  op: Operation | undefined
  refMaterials: Material[]
  onChange: (op: SpecOp | null) => void
}): React.JSX.Element {
  const entries = op?.type === 'spec-card' ? op.params.entries : []
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadFrom = async (refPath: string): Promise<void> => {
    setLoadError(null)
    try {
      const got = await window.hk.recipe.specFromReference(refPath)
      if (!got.length) {
        setLoadError('That ROM has no spec card entries.')
        return
      }
      commit(got as SpecEntry[])
    } catch (e) {
      setLoadError(errorText(e))
    }
  }
  const commit = (next: SpecEntry[]): void => {
    if (!next.length) return onChange(null)
    onChange({ id: SPEC_CARD_OP, type: 'spec-card', enabled: true, params: { entries: next } })
  }
  const setField = (i: number, group: 'basic' | 'camera', key: string, value: string): void => {
    const next = entries.map((e, k) =>
      k === i ? { ...e, [group]: { ...e[group], [key]: value } } : e
    )
    commit(next)
  }
  const setHwc = (i: number, value: string): void => {
    const hwc = value.includes(',')
      ? value
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : value.trim()
    commit(entries.map((e, k) => (k === i ? { ...e, hwc } : e)))
  }
  return (
    <div style={{ marginTop: 12 }} data-testid="speccard-panel">
      <div className="row">
        <strong>About phone spec card</strong>
        <span className="sub" style={{ margin: 0 }}>
          Writes product/etc/device_info.json (CPU, battery, camera, screen). Stock CN has none, so
          the card is empty until you fill it.
        </span>
        {refMaterials.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && void loadFrom(e.target.value)}
            data-testid="speccard-load-ref"
          >
            <option value="">Load defaults from a reference ROM…</option>
            {refMaterials.map((m) => (
              <option key={m.id} value={m.path}>
                {m.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {loadError && <p className="error-text">{loadError}</p>}
      {entries.map((e, i) => (
        <div className="panel" key={i} style={{ margin: '6px 0' }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <label>
              Region(s){' '}
              <input
                type="text"
                value={Array.isArray(e.hwc) ? e.hwc.join(', ') : e.hwc}
                onChange={(ev) => setHwc(i, ev.target.value)}
                placeholder="GL, or CN, IN"
                style={{ minWidth: 0, width: 140 }}
                data-testid={`speccard-hwc-${i}`}
              />
            </label>
            <span className="sub" style={{ margin: 0 }}>
              GL = global; CN/IN = China/India. Matches the device&apos;s region.
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={() => commit(entries.filter((_, k) => k !== i))}>Remove entry</button>
          </div>
          <table>
            <tbody>
              {BASIC_FIELDS.map(([key, label]) => (
                <tr key={key}>
                  <td style={{ width: 160 }}>{label}</td>
                  <td>
                    <input
                      type="text"
                      value={e.basic[key] ?? ''}
                      onChange={(ev) => setField(i, 'basic', key, ev.target.value)}
                      style={{ width: '100%' }}
                      data-testid={`speccard-basic-${key}-${i}`}
                    />
                  </td>
                </tr>
              ))}
              {CAMERA_FIELDS.map(([key, label]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>
                    <input
                      type="text"
                      value={e.camera[key] ?? ''}
                      onChange={(ev) => setField(i, 'camera', key, ev.target.value)}
                      style={{ width: '100%' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {entries.length === 0 && refMaterials.length > 0 && (
        <p className="sub" style={{ margin: '0 0 8px' }}>
          Empty on a CN base. Load the real values from a reference ROM:{' '}
          {refMaterials.map((m) => (
            <button
              key={m.id}
              className="primary"
              style={{ marginRight: 6 }}
              onClick={() => void loadFrom(m.path)}
              data-testid={`speccard-default-${m.id}`}
            >
              Load from {m.label}
            </button>
          ))}
        </p>
      )}
      <button onClick={() => commit([...entries, emptyEntry()])} data-testid="speccard-add">
        Add a region entry
      </button>
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
  gappsMaterials,
  current,
  onApply,
  onRemove
}: {
  gappsMaterials: Material[]
  current: Operation | null
  onApply: (ops: Operation[]) => void
  onRemove: () => void
}): React.JSX.Element {
  const [info, setInfo] = useState<GappsZipInfo | null>(null)
  const [exclude, setExclude] = useState<string[]>(GAPPS_DEFAULT_EXCLUDE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inspect = async (path: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setInfo(await window.hk.recipe.inspectGapps(path))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const pick = async (): Promise<void> => {
    const z = await window.hk.dialog.pickFile('Choose a MindTheGapps zip', ['zip'])
    if (z) await inspect(z)
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
        {gappsMaterials.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && void inspect(e.target.value)}
            data-testid="gapps-from-library"
          >
            <option value="">From library…</option>
            {gappsMaterials.map((m) => (
              <option key={m.id} value={m.path}>
                {m.label}
              </option>
            ))}
          </select>
        )}
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

type ReplaceOp = Extract<Operation, { type: 'app-replace' }>
type AddAppOp = Extract<Operation, { type: 'add-app' }>

function AppReplace({
  apks,
  baseSdk,
  materials,
  ops,
  onAdd,
  onRemove
}: {
  apks: ApkInfo[]
  baseSdk: number | null
  materials: Material[]
  ops: Operation[]
  onAdd: (op: ReplaceOp | AddAppOp) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const replaceable = useMemo(
    () => apks.filter((a) => a.size > 0 && !a.error && a.packageName),
    [apks]
  )
  const shown = useMemo(() => {
    const f = filter.toLowerCase()
    return replaceable
      .filter(
        (a) =>
          !f ||
          (a.packageName ?? '').toLowerCase().includes(f) ||
          `${a.partition}/${a.path}`.toLowerCase().includes(f)
      )
      .slice(0, 200)
  }, [replaceable, filter])
  const targetApk = replaceable.find((a) => `${a.partition}/${a.path}` === target)

  const add = async (apkPath: string, sha256: string): Promise<void> => {
    if (!target) {
      setError('Choose the app in the ROM to replace first.')
      return
    }
    onAdd({
      id: `app-replace-${target.replace(/[^a-z0-9]+/gi, '-')}`,
      type: 'app-replace',
      enabled: true,
      params: { apk: apkPath, sha256, target }
    })
    setError(null)
  }

  return (
    <div className="panel" data-testid="appreplace-panel">
      <p className="sub" style={{ margin: '0 0 8px' }}>
        Swap an app in the ROM for an external APK, like a modded launcher or SystemUI. The
        replacement keeps its own signature.{' '}
        <InfoDot title="What replacing a system app does">
          <p>
            The APK is written over the app&apos;s file in the ROM, keeping the original&apos;s
            owner, mode and SELinux label. Stale compiled code (oat/odex/vdex) and stock split APKs
            are removed so the new code runs.
          </p>
          <p>
            Android does not verify APK signatures on system partitions, so a differently signed APK
            loads, but it can no longer be updated from the store or OTA. If the original app shares
            a user id (sharedUserId), the replacement must use the same one or the device can fail
            to boot; HyperKitchen refuses a mismatch.
          </p>
          <p>
            Add APKs to the Materials library (Settings) first, then pick them here. For a whole app
            from another unpacked ROM, use &quot;Import from a reference ROM&quot; instead.
          </p>
        </InfoDot>
      </p>
      {ops.map((o) =>
        o.type === 'app-replace' ? (
          <p className="mono" key={o.id} data-testid={`appreplace-${o.id}`}>
            {o.params.target} ← {o.params.apk.split('/').pop()}{' '}
            <button onClick={() => onRemove(o.id)}>Remove</button>
          </p>
        ) : null
      )}
      <div className="row" style={{ marginBottom: 6 }}>
        <input
          type="text"
          placeholder="Filter ROM apps by package or path"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          data-testid="appreplace-target"
          style={{ maxWidth: 460 }}
        >
          <option value="">Choose the app in the ROM to replace ({shown.length})</option>
          {shown.map((a) => (
            <option key={`${a.partition}/${a.path}`} value={`${a.partition}/${a.path}`}>
              {a.packageName} ({a.partition}/{a.path})
            </option>
          ))}
        </select>
      </div>
      {targetApk?.sharedUserId && (
        <p className="sub" style={{ margin: '0 0 6px' }}>
          This app uses sharedUserId <span className="mono">{targetApk.sharedUserId}</span>; the
          replacement must declare the same one.
        </p>
      )}
      {materials.length === 0 ? (
        <p className="sub">
          No APKs in the Materials library yet. Add one in Settings → Materials library → Add app
          APK.
        </p>
      ) : (
        <table data-testid="appreplace-library">
          <tbody>
            {materials.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.label}
                  {m.meta && (
                    <div className="sub">
                      {m.meta.package}
                      {m.meta.sharedUserId ? ` · uid ${m.meta.sharedUserId}` : ''}
                      {m.meta.minSdk ? ` · minSdk ${m.meta.minSdk}` : ''}
                      {m.meta.minSdk && baseSdk != null && Number(m.meta.minSdk) > baseSdk ? (
                        <span className="error-text">
                          {' '}
                          needs API {m.meta.minSdk} &gt; base API {baseSdk}, will not run
                        </span>
                      ) : m.meta.minSdk && baseSdk != null ? (
                        <span style={{ color: 'var(--ok)' }}> fits API {baseSdk}</span>
                      ) : null}
                    </div>
                  )}
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      disabled={
                        !target ||
                        !m.sha256 ||
                        (m.meta?.minSdk != null &&
                          m.meta.minSdk !== '' &&
                          baseSdk != null &&
                          Number(m.meta.minSdk) > baseSdk)
                      }
                      title="Replace the app selected above with this APK"
                      onClick={() => void add(m.path, m.sha256 as string)}
                    >
                      Replace selected
                    </button>
                    <button
                      disabled={!m.sha256}
                      title="Add this APK to the ROM as a new app"
                      onClick={() => {
                        const name = (m.meta?.package ?? m.label).split('.').pop() || 'App'
                        const def = `product/app/${name}/${name}.apk`
                        const dest = window.prompt('Add at ROM path:', def)
                        if (!dest) return
                        onAdd({
                          id: `add-app-${dest.replace(/[^a-z0-9]+/gi, '-')}`,
                          type: 'add-app',
                          enabled: true,
                          params: { apk: m.path, sha256: m.sha256 as string, target: dest }
                        })
                      }}
                      data-testid={`appadd-${m.id}`}
                    >
                      Add as new app
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

const SET_LOCALE = 'set-default-locale'

// Toggles that HyperOS modders commonly use, each mapping to a debloat of standard packages.
// These package names are the same across HyperOS CN devices.
const TWEAKS: Array<{ id: string; title: string; hint: string; packages: string[] }> = [
  {
    id: 'disable-ota',
    title: 'Disable system (OTA) updates',
    hint: 'Removes the Updater app (com.android.updater). Recommended on a modded ROM: an OTA could overwrite the mod or fail to apply.',
    packages: ['com.android.updater']
  },
  {
    id: 'disable-analytics',
    title: 'Remove usage analytics',
    hint: 'Removes AnalyticsCore (com.miui.analytics), which reports usage data. MiSight is left alone because it shares the system user id and removing it can break boot.',
    packages: ['com.miui.analytics']
  },
  {
    id: 'disable-getapps-ads',
    title: 'Remove GetApps store',
    hint: 'Removes the Mi GetApps store (com.xiaomi.market), a common source of app ads and auto-installs. Leave on if you use it.',
    packages: ['com.xiaomi.market']
  }
]

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  zh: 'Chinese',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'bo-CN': 'Tibetan',
  'ug-CN': 'Uyghur'
}
const langName = (code: string): string => LANG_NAMES[code] ?? code

function SystemTweaks({
  ops,
  localeFile,
  supportedLocales,
  onChange
}: {
  ops: Operation[]
  localeFile: string
  supportedLocales: string[]
  onChange: (add: Operation[], removeIds: string[]) => void
}): React.JSX.Element {
  // Full BCP-47 locales (en-US) the ROM carries, plus their bare language (en) which also works.
  const choices = [
    ...new Set(supportedLocales.flatMap((l) => (l.includes('-') ? [l, l.split('-')[0]] : [l])))
  ]
    .filter((l) => l)
    .sort()
  const localeOp = ops.find((o) => o.id === SET_LOCALE)
  const chosen =
    localeOp?.type === 'set-props' ? (localeOp.params.set['ro.product.locale'] ?? '') : ''
  const setLocale = (value: string): void => {
    if (!value) {
      onChange([], [SET_LOCALE])
      return
    }
    onChange(
      [
        {
          id: SET_LOCALE,
          type: 'set-props',
          enabled: true,
          params: { file: localeFile, set: { 'ro.product.locale': value }, remove: [] }
        }
      ],
      []
    )
  }
  return (
    <div className="panel" data-testid="tweaks-panel">
      <div className="row">
        <strong>Default language</strong>
        <select
          value={chosen}
          onChange={(e) => setLocale(e.target.value)}
          data-testid="tweak-locale"
        >
          <option value="">Keep ROM default</option>
          {choices.map((code) => (
            <option key={code} value={code}>
              {langName(code)} ({code})
            </option>
          ))}
        </select>
        <InfoDot title="Default language">
          <p>
            Sets <code>ro.product.locale</code> in {localeFile}, the language the device starts in
            before the user picks one. Users can still change it in Settings.
          </p>
          <p>
            Only languages the ROM actually ships are listed. A CN base usually has only Chinese and
            English; picking a language the ROM lacks would just fall back to English.
          </p>
        </InfoDot>
      </div>
      <p className="sub" style={{ margin: '4px 0 0' }}>
        framework-res.apk includes:{' '}
        {supportedLocales.length ? supportedLocales.join(', ') : '(unknown)'}. The system language
        picker is limited to these, even though most other apps carry many more languages. Adding a
        language the picker does not list means replacing framework-res.apk (and Settings.apk) with
        versions from a global ROM that include it.
      </p>
      <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
        {TWEAKS.map((t) => {
          const op = ops.find((o) => o.id === t.id)
          return (
            <label key={t.id} style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={!!op?.enabled}
                onChange={(e) =>
                  e.target.checked
                    ? onChange(
                        [
                          {
                            id: t.id,
                            type: 'debloat',
                            enabled: true,
                            params: { packages: t.packages, force: false }
                          }
                        ],
                        []
                      )
                    : onChange([], [t.id])
                }
                data-testid={`tweak-${t.id}`}
              />{' '}
              <strong>{t.title}</strong>
              <div className="sub" style={{ margin: '2px 0 0 22px' }}>
                {t.hint}
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function Section({
  id,
  title,
  chip,
  defaultOpen,
  children
}: {
  id: string
  title: string
  chip: string | null
  defaultOpen: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`hk-section${open ? ' open' : ''}`}>
      <button
        type="button"
        className="hk-section-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={`section-${id}`}
      >
        <span className="hk-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="hk-section-title">{title}</span>
        {chip && <span className="hk-chip">{chip}</span>}
      </button>
      <div className="hk-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

type SetPropsOp = Extract<Operation, { type: 'set-props' }>
type DeviceFeatureOp = Extract<Operation, { type: 'device-feature' }>

/**
 * Optional flagship Xiaomi features enabled with the smallest possible change: a build.prop
 * value or a device_features flag the ROM already carries. Each is an individual checkbox.
 */
function FlagshipFeatures({
  ops,
  device,
  onChange
}: {
  ops: Operation[]
  device: string | null
  onChange: (add: Operation[], removeIds: string[]) => void
}): React.JSX.Element {
  const aodFile = `product/etc/device_features/${device ?? 'onyx'}.xml`
  const features: Array<{
    id: string
    label: string
    hint: string
    op: SetPropsOp | DeviceFeatureOp
  }> = [
    {
      id: 'flagship-bg-blur',
      label: 'Background blur on by default',
      hint: 'Turns the window/background blur on out of the box (the ROM already supports it: persist.sys.background_blur_supported=true). Sets persist.sys.background_blur_status_default=true.',
      op: {
        id: 'flagship-bg-blur',
        type: 'set-props',
        enabled: true,
        params: {
          file: 'product/etc/build.prop',
          set: { 'persist.sys.background_blur_status_default': 'true' },
          remove: []
        }
      }
    },
    {
      id: 'flagship-launch-blur',
      label: 'Blur behind app launch/close',
      hint: 'Enables the launcher blur during app open/close. Sets ro.launcher.blur.appLaunch=1.',
      op: {
        id: 'flagship-launch-blur',
        type: 'set-props',
        enabled: true,
        params: {
          file: 'system/system/build.prop',
          set: { 'ro.launcher.blur.appLaunch': '1' },
          remove: []
        }
      }
    },
    {
      id: 'flagship-fullscreen-aod',
      label: 'Fullscreen always-on display',
      hint: `Enables the fullscreen AOD style (support_aod_fullscreen) in ${aodFile}. Always-on AOD itself is already available in Settings.`,
      op: {
        id: 'flagship-fullscreen-aod',
        type: 'device-feature',
        enabled: true,
        params: { file: aodFile, bools: { support_aod_fullscreen: true }, ints: {} }
      }
    }
  ]
  return (
    <div className="panel">
      <p className="sub" style={{ margin: '0 0 8px' }}>
        Each option is one small, verified change (a prop or a device flag the ROM already has).
        Tick only what you want.
      </p>
      {features.map((f) => {
        const on = ops.some((o) => o.id === f.id && o.enabled)
        return (
          <label key={f.id} style={{ display: 'block', marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => (e.target.checked ? onChange([f.op], []) : onChange([], [f.id]))}
              data-testid={f.id}
            />{' '}
            <strong>{f.label}</strong>
            <div className="sub" style={{ margin: '2px 0 0 22px' }}>
              {f.hint}
            </div>
          </label>
        )
      })}
      <p className="sub" style={{ margin: '6px 0 0' }}>
        Not offered here, and why: 1/30/90 Hz refresh needs an LTPO panel or driver support this
        device lacks (onyx exposes 60 and 120 Hz only); disabling the app-install security scan and
        enabling USB debugging are runtime settings best done after boot with ADB/Shizuku, not a
        clean build-time change.
      </p>
    </div>
  )
}
