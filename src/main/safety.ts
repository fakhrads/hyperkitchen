import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Hard rule: the tool only writes inside directories it owns (a project dir or
 * the app data dir). Every write path computed from user or recipe input goes
 * through this check.
 */
export function isInside(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function assertInside(base: string, target: string): string {
  if (!isInside(base, target)) {
    throw new Error(`refusing to touch ${target}: outside ${base}`)
  }
  return resolve(target)
}

/** Project names become folder names; keep them boring and portable. */
export function validateProjectName(name: string): string {
  const n = name.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(n)) {
    throw new Error(
      'project name: 1-64 chars, letters, digits, space, dot, dash, underscore; must start with a letter or digit'
    )
  }
  if (n === '.' || n === '..' || n.endsWith('.') || n.endsWith(' ')) {
    throw new Error('project name cannot end with a dot or space')
  }
  return n
}
