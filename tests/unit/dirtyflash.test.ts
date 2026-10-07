import { describe, expect, it } from 'vitest'
import { compareBuildFlash } from '../../src/shared/dirtyflash'
import type { BuildInfo } from '../../src/shared/types'

const build = (over: Partial<BuildInfo>): BuildInfo =>
  ({
    schema: 1,
    id: 'b',
    status: 'done',
    dataFormat: { level: 'not-needed', reasons: [] },
    ...over
  }) as BuildInfo

describe('compareBuildFlash', () => {
  it('is dirty-flashable when signers and encryption match', () => {
    const a = build({ signers: { 'com.x': 's1', 'com.y': 's2' }, encryptionOff: false })
    const b = build({ signers: { 'com.x': 's1', 'com.y': 's2' }, encryptionOff: false })
    const r = compareBuildFlash(a, b)
    expect(r.dirtyFlashable).toBe(true)
    expect(r.reasons).toEqual([])
    expect(r.known).toBe(true)
  })

  it('needs a format when a shared package was re-signed', () => {
    const a = build({ signers: { 'com.x': 'stock', 'com.android.vending': 'stub' } })
    const b = build({ signers: { 'com.x': 'stock', 'com.android.vending': 'phonesky' } })
    const r = compareBuildFlash(a, b)
    expect(r.dirtyFlashable).toBe(false)
    expect(r.resigned).toEqual(['com.android.vending'])
  })

  it('ignores packages that are only in one build (added or removed)', () => {
    const a = build({ signers: { 'com.x': 's1' } })
    const b = build({ signers: { 'com.x': 's1', 'com.google.android.gms': 'g' } })
    expect(compareBuildFlash(a, b).dirtyFlashable).toBe(true)
  })

  it('needs a format when the encryption mode changed', () => {
    const a = build({ signers: { 'com.x': 's1' }, encryptionOff: false })
    const b = build({ signers: { 'com.x': 's1' }, encryptionOff: true })
    const r = compareBuildFlash(a, b)
    expect(r.dirtyFlashable).toBe(false)
    expect(r.reasons[0]).toMatch(/encryption/)
  })

  it('falls back to the new build verdict when a fingerprint is missing', () => {
    const a = build({}) // no signers (older build)
    const b = build({
      signers: { 'com.x': 's1' },
      dataFormat: { level: 'first-install', reasons: ['play store'] }
    })
    const r = compareBuildFlash(a, b)
    expect(r.known).toBe(false)
    expect(r.dirtyFlashable).toBe(false)
  })
})
