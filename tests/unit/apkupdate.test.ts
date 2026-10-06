// APK update check: parse the latest version from a memeosupdates page's JSON-LD and compare
// dotted version names. Pure functions; no network.
import { describe, expect, it } from 'vitest'
import { compareVersionNames, parseLatestVersion } from '../../src/main/apkupdate'

describe('version comparison', () => {
  it('compares dotted-numeric versions', () => {
    expect(compareVersionNames('9.3.0.2', '8.2.0.4')).toBe(1)
    expect(compareVersionNames('8.2.0.4', '9.3.0.2')).toBe(-1)
    expect(compareVersionNames('8.2.0.4', '8.2.0.4')).toBe(0)
    expect(compareVersionNames('8.2', '8.2.0.0')).toBe(0)
    expect(compareVersionNames('8.2.1', '8.2')).toBe(1)
  })
  it('returns null when a version is not purely dotted-numeric', () => {
    expect(compareVersionNames('16-13928101', '16')).toBeNull()
    expect(compareVersionNames('1.0-beta', '1.0')).toBeNull()
    expect(compareVersionNames('googletts.x', '1.0')).toBeNull()
  })
})

describe('parseLatestVersion', () => {
  const ld = (obj: object): string =>
    `<script type="application/ld+json">${JSON.stringify(obj)}</script>`
  it('reads the version from the JSON-LD name when there is no description', () => {
    const html = ld({
      '@type': 'WebPage',
      name: 'HyperOS Files APK Download - Latest RELEASE-9.3.0.2 Version'
    })
    // The name carries the RELEASE- prefix; the comparison strips it.
    expect(parseLatestVersion(html)).toBe('RELEASE-9.3.0.2')
  })
  it('prefers the cleaner description over the name', () => {
    const html = ld({
      name: 'HyperOS Files APK Download - Latest RELEASE-9.3.0.2 Version',
      description: 'Download ... (Version: 9.3.0.2) for ...'
    })
    expect(parseLatestVersion(html)).toBe('9.3.0.2')
  })
  it('falls back to the description', () => {
    const html = ld({ name: 'HyperOS Files', description: 'Download ... (Version: 5.4.2.23) ...' })
    expect(parseLatestVersion(html)).toBe('5.4.2.23')
  })
  it('reads a RELEASE-prefixed launcher version from the description', () => {
    const html = ld({
      name: 'HyperOS Launcher APK Download - Latest RELEASE-RELEASE-8.01.02.7726-260904-R Version',
      description: 'Download ... (Version: RELEASE-8.01.02.7726-260904-R) for ...'
    })
    expect(parseLatestVersion(html)).toBe('RELEASE-8.01.02.7726-260904-R')
  })
  it('rejects a capture with no digit', () => {
    expect(parseLatestVersion(ld({ name: 'X - Latest RELEASE Version' }))).toBeNull()
  })
  it('returns null when there is no version or no JSON-LD', () => {
    expect(parseLatestVersion('<html><body>nothing</body></html>')).toBeNull()
    expect(parseLatestVersion(ld({ name: 'No version here' }))).toBeNull()
    expect(parseLatestVersion('<script type="application/ld+json">{bad json</script>')).toBeNull()
  })
})
