import { useEffect, useMemo, useState } from 'react'
import type { PatchSetInfo } from '../../../shared/ipc'
import { purecnPreset } from '../../../shared/presets'
import type { Operation, Recipe } from '../../../shared/recipe'
import type { StockInfo } from '../../../shared/types'
import { errorText } from '../format'

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
        {catalog.map((p) => {
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
