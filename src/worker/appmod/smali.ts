// Smali helpers for the app editor: list methods, replace a method body with a constant return.
//
// Return instructions per the Dalvik bytecode reference
// (https://source.android.com/docs/core/runtime/dalvik-bytecode): return-void, return (32-bit:
// Z B S C I F), return-wide (J D, a register pair), return-object (L and [; only null here).

export interface SmaliMethod {
  /** Name and descriptor as written after the modifiers, e.g. isShowAd()Z. */
  sig: string
  modifiers: string[]
  returnType: string
  line: number
}

const METHOD_RE = /^\.method ((?:[a-z-]+ )*)(\S+\(.*\)(\S+))\s*$/gm

export function listMethods(text: string): SmaliMethod[] {
  const out: SmaliMethod[] = []
  for (const m of text.matchAll(METHOD_RE)) {
    out.push({
      sig: m[2],
      modifiers: m[1].trim() ? m[1].trim().split(' ') : [],
      returnType: m[3],
      line: text.slice(0, m.index).split('\n').length
    })
  }
  return out
}

/** The value a stub returns, by return type kind. */
export type StubValue = 'void' | 0 | 1 | 'null'

export function stubValues(returnType: string): StubValue[] {
  if (returnType === 'V') return ['void']
  if (returnType === 'Z') return [0, 1]
  if (/^[BSCIJFD]$/.test(returnType)) return [0]
  return ['null']
}

/**
 * Replace the body of method `sig` with a constant return. Annotations of the method are kept
 * (they carry generic signatures and throws clauses); abstract and native methods are refused.
 */
export function stubMethod(text: string, sig: string, value: StubValue): string {
  const m = listMethods(text).find((x) => x.sig === sig)
  if (!m) throw new Error(`method ${sig} not found`)
  if (m.modifiers.includes('abstract') || m.modifiers.includes('native'))
    throw new Error(`${sig} has no body (${m.modifiers.join(' ')})`)
  if (!stubValues(m.returnType).includes(value))
    throw new Error(`${sig} returns ${m.returnType}; ${value} is not a valid value`)
  const lines = text.split('\n')
  const start = m.line - 1
  let end = start + 1
  while (end < lines.length && lines[end].trim() !== '.end method') end++
  if (end >= lines.length) throw new Error(`${sig} has no .end method`)
  const body = lines.slice(start + 1, end).join('\n')
  const annotations =
    body.match(/^[ \t]*\.annotation[\s\S]*?^[ \t]*\.end annotation[ \t]*$/gm) ?? []
  const t = m.returnType
  let code: string[]
  if (value === 'void') code = ['    .locals 0', '', '    return-void']
  else if (t === 'J' || t === 'D')
    code = ['    .locals 2', '', '    const-wide/16 v0, 0x0', '', '    return-wide v0']
  else if (value === 'null')
    code = ['    .locals 1', '', '    const/4 v0, 0x0', '', '    return-object v0']
  else code = ['    .locals 1', '', `    const/4 v0, 0x${value}`, '', '    return v0']
  const replaced = [
    lines[start],
    ...(annotations.length ? [annotations.join('\n'), ''] : []),
    ...code
  ]
  return [...lines.slice(0, start), ...replaced, ...lines.slice(end)].join('\n')
}
