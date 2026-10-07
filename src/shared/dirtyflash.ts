// Compare two builds for dirty-flash safety. Flashing `next` over a device running `installed`
// keeps /data only when nothing on data conflicts: the encryption mode is the same, and no
// package present in both builds was re-signed (a signer change makes the old /data for that app
// incompatible, so the platform needs a data format).

import type { BuildInfo } from './types'

export interface FlashCompare {
  /** True when flashing `next` over `installed` can keep data. */
  dirtyFlashable: boolean
  /** Why a format is needed, empty when dirty-flashable. */
  reasons: string[]
  /** Packages present in both builds whose signer changed. */
  resigned: string[]
  /** False when a build predates signer fingerprints, so the verdict falls back to next's own. */
  known: boolean
}

export function compareBuildFlash(installed: BuildInfo, next: BuildInfo): FlashCompare {
  const a = installed.signers
  const b = next.signers
  if (!a || !b) {
    const ok = next.dataFormat.level === 'not-needed'
    return {
      dirtyFlashable: ok,
      reasons: ok ? [] : next.dataFormat.reasons,
      resigned: [],
      known: false
    }
  }
  const reasons: string[] = []
  if (Boolean(installed.encryptionOff) !== Boolean(next.encryptionOff)) {
    reasons.push('the /data encryption mode changed, so data must be re-created (format)')
  }
  const resigned = Object.keys(b)
    .filter((pkg) => pkg in a && a[pkg] !== b[pkg])
    .sort()
  if (resigned.length) {
    reasons.push(
      `these apps were re-signed since the installed build, so their data no longer matches: ${resigned.join(', ')}`
    )
  }
  return { dirtyFlashable: reasons.length === 0, reasons, resigned, known: true }
}
