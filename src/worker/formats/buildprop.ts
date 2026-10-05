// build.prop / default.prop: one key=value per line, '#' comments, 'import <file>' directives.

export interface PropLine {
  key: string
  value: string
  line: number
}

export function parseProps(text: string): PropLine[] {
  const out: PropLine[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim()
    if (!l || l.startsWith('#') || l.startsWith('import ')) return
    const eq = l.indexOf('=')
    if (eq <= 0) return
    out.push({ key: l.slice(0, eq).trim(), value: l.slice(eq + 1).trim(), line: i + 1 })
  })
  return out
}

/** Last assignment wins, matching how init reads a single file. */
export function propMap(lines: PropLine[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const l of lines) m[l.key] = l.value
  return m
}

/** Where each partition keeps its build.prop, relative to the partition root. */
export const BUILD_PROP_PATHS = ['system/build.prop', 'build.prop', 'etc/build.prop']
