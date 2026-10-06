// resources.arsc locale reader.
import { describe, expect, it } from 'vitest'
import { arscLocales } from '../../src/worker/formats/arsc'
import { arscWithLocales } from '../fixtures/apk'

describe('arscLocales', () => {
  it('reads the locales a table declares, ignoring the default config', () => {
    expect(arscLocales(arscWithLocales(['en-US', 'zh-CN', 'zh-TW', 'en']))).toEqual([
      'en',
      'en-US',
      'zh-CN',
      'zh-TW'
    ])
  })
  it('returns nothing for a non-table buffer', () => {
    expect(arscLocales(Buffer.from('not an arsc'))).toEqual([])
  })
})
