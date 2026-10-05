// Templates and recipe reproducibility (M10).
import { describe, expect, it } from 'vitest'
import { RecipeSchema } from '../../src/shared/recipe'
import { cnToGlobalDaily, TEMPLATES } from '../../src/shared/presets'

describe('templates', () => {
  it('every template builds a valid recipe with unique ids', () => {
    for (const t of TEMPLATES) {
      const ops = t.build({ romName: 'HyperKitchen' })
      const recipe = RecipeSchema.parse({ schema: 1, operations: ops })
      const ids = recipe.operations.map((o) => o.id)
      expect(new Set(ids).size, t.id).toBe(ids.length)
      expect(ops.length).toBeGreaterThan(0)
    }
  })

  it('cn-to-global-daily needs no external files and adds branding only with a name', () => {
    const noName = cnToGlobalDaily()
    // No op references a host file or a reference project.
    for (const op of noName) {
      expect(op.type).not.toBe('gapps')
      expect(op.type).not.toBe('import-from-rom')
      expect(op.type).not.toBe('media')
    }
    expect(noName.some((o) => o.id === 'branding-prop')).toBe(false)
    const withName = cnToGlobalDaily({ romName: 'My ROM' })
    const prop = withName.find((o) => o.id === 'branding-prop')
    expect(prop?.type === 'set-props' && prop.params.set['ro.hyperkitchen.rom.display']).toBe(
      'My ROM'
    )
    expect(withName.some((o) => o.type === 'patch' && o.params.patchSet === 'branding-about')).toBe(
      true
    )
    // A blank name is treated as no name.
    expect(cnToGlobalDaily({ romName: '  ' }).some((o) => o.id === 'branding-prop')).toBe(false)
  })

  it('both templates include the CN notification patch and the GMS unlock', () => {
    for (const t of TEMPLATES) {
      const ops = t.build({})
      expect(ops.some((o) => o.type === 'unlock-cn-gms')).toBe(true)
      expect(ops.some((o) => o.type === 'patch' && o.params.patchSet === 'cn-notifications')).toBe(
        true
      )
    }
  })
})
