// Line diff for showing an edited file against the stock decode (LCS over lines, with the
// common head and tail trimmed first so typical small edits stay cheap).

export interface DiffLine {
  kind: ' ' | '-' | '+'
  text: string
}

const MAX_CELLS = 4_000_000

export function lineDiff(a: string, b: string): DiffLine[] | null {
  const x = a.split('\n')
  const y = b.split('\n')
  let head = 0
  while (head < x.length && head < y.length && x[head] === y[head]) head++
  let tail = 0
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  )
    tail++
  const xs = x.slice(head, x.length - tail)
  const ys = y.slice(head, y.length - tail)
  if (xs.length * ys.length > MAX_CELLS) return null
  const n = xs.length
  const m = ys.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = xs[i] === ys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffLine[] = x.slice(0, head).map((text) => ({ kind: ' ', text }))
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) {
      out.push({ kind: ' ', text: xs[i] })
      i++
      j++
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ kind: '+', text: ys[j++] })
    } else {
      out.push({ kind: '-', text: xs[i++] })
    }
  }
  out.push(...x.slice(x.length - tail).map((text) => ({ kind: ' ' as const, text })))
  return out
}

/** Changed lines with `context` unchanged lines around them; gaps become null. */
export function hunks(lines: DiffLine[], context = 3): Array<DiffLine | null> {
  const keep = new Uint8Array(lines.length)
  lines.forEach((l, i) => {
    if (l.kind === ' ') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++)
      keep[k] = 1
  })
  const out: Array<DiffLine | null> = []
  lines.forEach((l, i) => {
    if (keep[i]) out.push(l)
    else if (out.length && out[out.length - 1] !== null) out.push(null)
  })
  return out
}
