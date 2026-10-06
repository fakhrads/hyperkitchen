// Android fstab: <src> <mount point> <type> <mount flags> <fs_mgr flags>, whitespace separated,
// fs_mgr flags comma separated. First-stage init sets up dm-verity only for entries with
// avb_keys, avb or avb_hashtree_digest (init/first_stage_mount.cpp, SetUpDmVerity). Removing
// those flags mounts the partition without verity. Global onyx ROMs make the same edit
// (avb= and avb_keys=) in the vendor_boot first-stage fstab; MIO-KITCHEN's avb_disabler too.

const AVB_FLAG = /^(avb|avb=.*|avb_keys=.*|avb_hashtree_digest=.*)$/

export interface FstabEdit {
  text: string
  /** 1-based line numbers that changed. */
  changed: number[]
}

export function stripAvbFlags(text: string): FstabEdit {
  const changed: number[] = []
  const lines = text.split('\n').map((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return line
    // Split keeping the original whitespace so untouched columns stay byte-identical.
    const parts = line.split(/(\s+)/)
    let field = -1
    for (let k = 0; k < parts.length; k++) {
      if (!parts[k] || /^\s+$/.test(parts[k])) continue
      field++
      if (field !== 4) continue
      const kept = parts[k].split(',').filter((f) => !AVB_FLAG.test(f))
      const next = kept.join(',')
      if (next !== parts[k]) {
        parts[k] = next
        changed.push(i + 1)
      }
      break
    }
    return parts.join('')
  })
  return { text: lines.join('\n'), changed }
}

/** True when any entry still carries an avb flag. */
export function hasAvbFlags(text: string): boolean {
  return stripAvbFlags(text).changed.length > 0
}
