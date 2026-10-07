import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApkInfo } from '../../../shared/types'
import type { Operation, Recipe } from '../../../shared/recipe'
import { DEBLOAT_CATALOG, type DebloatRemoval } from '../../../shared/debloat-catalog'

// Core system UIDs/packages the debloat op refuses without force (mirrors worker/recipe/ops.ts).
const PROTECTED_UIDS = new Set([
  'android.uid.system',
  'android.uid.phone',
  'android.uid.systemui',
  'android.uid.shell',
  'android.uid.networkstack',
  'android.uid.bluetooth',
  'android.uid.nfc',
  'android.uid.se'
])
const PROTECTED_PKGS = new Set(['android', 'com.android.systemui', 'com.android.settings'])
const USER_DEBLOAT = 'user-debloat'
const USER_DEBLOAT_CORE = 'user-debloat-core'

type Group = 'ads' | DebloatRemoval | 'other'
const GROUPS: { id: Group; title: string; hint: string }[] = [
  {
    id: 'ads',
    title: 'Ads & bloat',
    hint: 'Built-in ad, recommendation and analytics apps. Safe to remove and the first thing to drop.'
  },
  { id: 'recommended', title: 'Recommended', hint: 'Marked safe to remove for most people.' },
  {
    id: 'advanced',
    title: 'Advanced',
    hint: 'Remove if you know you do not use them; some features may change.'
  },
  {
    id: 'expert',
    title: 'Expert',
    hint: 'Only if you understand the effect; parts of the system may rely on them.'
  },
  {
    id: 'unsafe',
    title: 'Unsafe',
    hint: 'May bootloop or break core functions. Avoid unless you are sure.'
  },
  { id: 'other', title: 'Not in the catalog', hint: 'No recommendation data. Your call.' }
]

interface Row {
  pkg: string
  core: boolean
  removal?: DebloatRemoval
  ad: boolean
  description?: string
}

const BADGE: Record<Group, { bg: string; fg: string }> = {
  ads: { bg: '#ffe0e0', fg: '#8a1f1f' },
  recommended: { bg: '#e0f0e0', fg: '#1f6a2e' },
  advanced: { bg: '#fff2d6', fg: '#8a5a00' },
  expert: { bg: '#ffe8cc', fg: '#9a4a00' },
  unsafe: { bg: '#ffd6d6', fg: '#9a0000' },
  other: { bg: '#e6e6e6', fg: '#555' }
}

export function DebloatTab({
  projectPath,
  apks
}: {
  projectPath: string
  apks: ApkInfo[]
}): React.JSX.Element {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  // True once the user toggles anything; stops a slow recipe load from clobbering their picks.
  const touchedRef = useRef(false)

  useEffect(() => {
    let alive = true
    void window.hk.recipe
      .get(projectPath)
      .then((r) => {
        if (!alive) return
        setRecipe(r)
        const sel = new Set<string>()
        for (const o of r.operations)
          if (o.type === 'debloat') for (const p of o.params.packages) sel.add(p)
        setSaved(new Set(sel))
        if (!touchedRef.current) setSelected(new Set(sel))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [projectPath])

  const rows = useMemo<Row[]>(() => {
    const seen = new Map<string, Row>()
    for (const a of apks) {
      const pkg = a.packageName
      if (!pkg || a.overlayTarget || seen.has(pkg)) continue
      const cat = DEBLOAT_CATALOG[pkg]
      const core =
        (a.sharedUserId ? PROTECTED_UIDS.has(a.sharedUserId) : false) || PROTECTED_PKGS.has(pkg)
      seen.set(pkg, {
        pkg,
        core,
        removal: cat?.removal,
        ad: cat?.ad ?? false,
        description: cat?.description
      })
    }
    return [...seen.values()].sort((x, y) => x.pkg.localeCompare(y.pkg))
  }, [apks])

  const groupOf = (r: Row): Group => (r.ad ? 'ads' : (r.removal ?? 'other'))
  const coreOf = useMemo(() => new Map(rows.map((r) => [r.pkg, r.core])), [rows])

  const q = filter.trim().toLowerCase()
  const visible = q
    ? rows.filter(
        (r) => r.pkg.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
      )
    : rows

  const toggle = (pkg: string): void => {
    touchedRef.current = true
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(pkg)) n.delete(pkg)
      else n.add(pkg)
      return n
    })
  }

  const autoDebloat = (): void => {
    touchedRef.current = true
    setSelected((s) => {
      const n = new Set(s)
      for (const r of rows) if (!r.core && (r.ad || r.removal === 'recommended')) n.add(r.pkg)
      return n
    })
  }

  const selectAds = (): void => {
    touchedRef.current = true
    setSelected((s) => {
      const n = new Set(s)
      for (const r of rows) if (!r.core && r.ad) n.add(r.pkg)
      return n
    })
  }

  const clearAll = (): void => {
    touchedRef.current = true
    setSelected(new Set())
  }

  const dirty = selected.size !== saved.size || [...selected].some((p) => !saved.has(p))
  const coreCount = [...selected].filter((p) => coreOf.get(p)).length

  const save = async (): Promise<void> => {
    if (!recipe) return
    setBusy(true)
    try {
      const nonCore = [...selected].filter((p) => !coreOf.get(p)).sort()
      const core = [...selected].filter((p) => coreOf.get(p)).sort()
      const ops: Operation[] = recipe.operations.filter((o) => o.type !== 'debloat')
      if (nonCore.length)
        ops.push({
          id: USER_DEBLOAT,
          type: 'debloat',
          enabled: true,
          params: { packages: nonCore, force: false }
        } as Operation)
      if (core.length)
        ops.push({
          id: USER_DEBLOAT_CORE,
          type: 'debloat',
          enabled: true,
          params: { packages: core, force: true }
        } as Operation)
      const r = await window.hk.recipe.save(projectPath, { ...recipe, operations: ops })
      setRecipe(r)
      setSaved(new Set(selected))
    } finally {
      setBusy(false)
    }
  }

  const adTotal = rows.filter((r) => r.ad).length

  return (
    <div>
      <div className="recipe-summary" style={{ marginBottom: 12 }}>
        <strong>{selected.size}</strong> app selected for removal
        {coreCount > 0 && <span> ({coreCount} core, removed with force)</span>}. Catalog:{' '}
        {rows.length} apps, {adTotal} flagged as ads/bloat. Removal is applied when you build. Core
        and system apps are protected unless you tick them.
      </div>

      <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <button className="primary" onClick={autoDebloat} data-testid="debloat-auto">
          Auto debloat (ads + recommended)
        </button>
        <button onClick={selectAds} data-testid="debloat-ads">
          Select ads only
        </button>
        <button onClick={clearAll}>Clear</button>
        <input
          placeholder="Filter by package or description"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
          data-testid="debloat-filter"
        />
        <button
          className={dirty ? 'primary' : ''}
          disabled={!dirty || busy}
          onClick={() => void save()}
          data-testid="debloat-save"
        >
          {busy ? 'Saving...' : dirty ? 'Save to recipe' : 'Saved'}
        </button>
      </div>

      {GROUPS.map((g) => {
        const items = visible.filter((r) => groupOf(r) === g.id)
        if (!items.length) return null
        const sel = items.filter((r) => selected.has(r.pkg)).length
        return (
          <div
            key={g.id}
            className="panel"
            style={{ marginBottom: 12 }}
            data-testid={`debloat-group-${g.id}`}
          >
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>
                {g.title}{' '}
                <span
                  className="hk-chip"
                  style={{ background: BADGE[g.id].bg, color: BADGE[g.id].fg }}
                >
                  {sel}/{items.length}
                </span>
              </strong>
            </div>
            <div className="sub" style={{ marginBottom: 8 }}>
              {g.hint}
            </div>
            {items.map((r) => (
              <label
                key={r.pkg}
                style={{ display: 'block', marginBottom: 6 }}
                data-testid={`debloat-row-${r.pkg}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.pkg)}
                  onChange={() => toggle(r.pkg)}
                />{' '}
                <span className="mono">{r.pkg}</span>
                {r.ad && (
                  <span
                    className="hk-chip"
                    style={{ background: BADGE.ads.bg, color: BADGE.ads.fg, marginLeft: 6 }}
                  >
                    ads
                  </span>
                )}
                {r.core && (
                  <span
                    className="hk-chip"
                    style={{ background: '#ffd6d6', color: '#9a0000', marginLeft: 6 }}
                  >
                    core (force)
                  </span>
                )}
                {r.description && (
                  <div className="sub" style={{ margin: '2px 0 0 22px' }}>
                    {r.description}
                  </div>
                )}
              </label>
            ))}
          </div>
        )
      })}
    </div>
  )
}
