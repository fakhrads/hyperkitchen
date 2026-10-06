// Best-effort "is there a newer version?" check for a system app, against the community tracker
// memeosupdates.com. There is no API; each app has a page at /apps/<package>/ whose JSON-LD
// (schema.org WebPage) names the latest version it tracks, e.g.
//   "name": "HyperOS Files APK Download - Latest RELEASE-9.3.0.2 Version"
//   "description": "... (Version: 9.3.0.2) ..."
//
// This is unofficial and may track a different region or variant than the ROM, so HyperKitchen
// reports what it finds and links to the page; it never downloads or installs anything. On-demand
// per app (never a bulk crawl of the whole inventory).

import { z } from 'zod'

const DEFAULT_SOURCE = 'https://memeosupdates.com'
const PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/

export type UpdateRelation = 'newer' | 'same' | 'older' | 'unknown'

export interface ApkUpdateResult {
  packageName: string
  source: string
  url: string
  /** Latest version string the tracker shows, or null when the app is not listed/parse failed. */
  latest: string | null
  current: string | null
  relation: UpdateRelation
  note?: string
}

/** Compare two dotted-numeric version names. null when either is not purely dotted-numeric. */
export function compareVersionNames(a: string, b: string): number | null {
  const parse = (v: string): number[] | null => {
    const m = v.trim().match(/^\d+(\.\d+)*/)
    if (!m || m[0] !== v.trim()) return null
    return m[0].split('.').map(Number)
  }
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/** The latest version string from a memeosupdates app page's JSON-LD or title. */
export function parseLatestVersion(html: string): string | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]) as { name?: string; description?: string }
      // description: "... (Version: <v>) ..."; name: "... - Latest <v> Version".
      const from = (str?: string): string | null => {
        const v =
          str?.match(/\(Version:\s*([^)]+?)\)/i)?.[1] ??
          str?.match(/-\s*Latest\s+(.+?)\s+Version\b/i)?.[1]
        const trimmed = v?.trim()
        // Reject a capture with no digit (e.g. a stray "RELEASE").
        return trimmed && /\d/.test(trimmed) ? trimmed : null
      }
      const v = from(d.description) ?? from(d.name)
      if (v) return v
    } catch {
      // not valid JSON-LD; try the next block
    }
  }
  return null
}

export async function checkApkUpdate(opts: {
  packageName: unknown
  currentVersionName: unknown
  source?: string
}): Promise<ApkUpdateResult> {
  const packageName = z.string().regex(PKG, 'not a package name').parse(opts.packageName)
  const current = z
    .string()
    .nullable()
    .parse(opts.currentVersionName ?? null)
  const source = (opts.source ?? DEFAULT_SOURCE).replace(/\/+$/, '')
  const url = `${source}/apps/${packageName}/`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  let latest: string | null = null
  let note: string | undefined
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'HyperKitchen', accept: 'text/html' }
    })
    if (res.status === 404) note = 'not listed on the tracker'
    else if (!res.ok) note = `tracker returned HTTP ${res.status}`
    else latest = parseLatestVersion(await res.text())
    if (res.ok && !latest && !note) note = 'could not read a version from the page'
  } catch (e) {
    note = `could not reach the tracker: ${(e as Error).message}`
  } finally {
    clearTimeout(timer)
  }

  const strip = (v: string): string => v.replace(/^RELEASE-/i, '')
  let relation: UpdateRelation = 'unknown'
  if (latest && current) {
    const c = compareVersionNames(strip(latest), strip(current))
    relation = c === null ? 'unknown' : c > 0 ? 'newer' : c < 0 ? 'older' : 'same'
  }
  return { packageName, source, url, latest, current, relation, note }
}
