// String resources in decoded res/values*/strings.xml files.
//
// Escaping follows the Android string resource rules
// (https://developer.android.com/guide/topics/resources/string-resource#escaping_quotes):
// XML entities for & and <, a backslash before ' and " and a leading @ or ?, \n for a newline.

export interface StringRes {
  name: string
  /** Raw XML content between the tags. */
  raw: string
  /** The text as the app sees it (escapes resolved, markup kept). */
  value: string
  attrs: string
}

const STRING_RE = /^([ \t]*)<string name="([^"]+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/string>)/gm

export function escapeString(value: string): string {
  let s = value
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  if (/^[@?]/.test(s)) s = '\\' + s
  return s
}

export function unescapeString(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}

export function listStrings(xml: string): StringRes[] {
  const out: StringRes[] = []
  for (const m of xml.matchAll(STRING_RE)) {
    const raw = m[4] ?? ''
    out.push({ name: m[2], raw, value: unescapeString(raw), attrs: m[3].trim() })
  }
  return out
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/

/** Set (or add) <string name=...> to `value`; other attributes of an existing entry are kept. */
export function setString(xml: string, name: string, value: string): string {
  if (!NAME.test(name)) throw new Error(`invalid resource name: ${name}`)
  const content = escapeString(value)
  let found = false
  const next = xml.replace(STRING_RE, (all, ind: string, n: string, attrs: string) => {
    if (n !== name) return all
    found = true
    return `${ind}<string name="${n}"${attrs.replace(/\s*$/, '')}>${content}</string>`
  })
  if (found) return next
  const end = xml.lastIndexOf('</resources>')
  if (end < 0) throw new Error('not a resources file')
  return `${xml.slice(0, end)}    <string name="${name}">${content}</string>\n${xml.slice(end)}`
}

/** Remove <string name=...>; returns the text unchanged when absent. */
export function removeString(xml: string, name: string): string {
  const m = [...xml.matchAll(STRING_RE)].find((x) => x[2] === name)
  if (!m || m.index === undefined) return xml
  let end = m.index + m[0].length
  if (xml[end] === '\r') end++
  if (xml[end] === '\n') end++
  return xml.slice(0, m.index) + xml.slice(end)
}
