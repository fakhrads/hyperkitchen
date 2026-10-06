// Recipe engine: WorkTree metadata bookkeeping, file operations, smali rules and the zip
// rewriter used for patched jars and APKs.
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OperationSchema, RecipeSchema } from '../../src/shared/recipe'
import { readSigner } from '../../src/worker/formats/apksig'
import { ZipFile } from '../../src/worker/formats/zip'
import { alignedExtra, rewriteZip } from '../../src/worker/formats/zipwrite'
import {
  apkRemovalTarget,
  dropLines,
  editProps,
  FILE_OPS,
  newReport
} from '../../src/worker/recipe/ops'
import { applyRule, artifactsOf, devicePath, normalizeSmali } from '../../src/worker/recipe/patcher'
import { PATCH_SETS } from '../../src/worker/recipe/patchsets'
import { escapeContextPath, unescapeContextPath, WorkTree } from '../../src/worker/recipe/tree'
import { der, schemeBlock, signingBlock, zip } from '../fixtures/apk'

let tmp: string
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-recipe-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

// A small tree in the layout extract.erofs writes, including the quirks: "/" and "<p>/" root
// entries, a trailing-slash duplicate in file_contexts and escaped names.
async function makeTree(): Promise<string> {
  const root = join(tmp, `t${Math.random().toString(36).slice(2)}`)
  await mkdir(join(root, 'config'), { recursive: true })
  await mkdir(join(root, 'product', 'app', 'Foo'), { recursive: true })
  await mkdir(join(root, 'product', 'lib64'), { recursive: true })
  await mkdir(join(root, 'product', 'etc'), { recursive: true })
  await writeFile(join(root, 'product', 'app', 'Foo', 'Foo.apk'), 'apk')
  await writeFile(join(root, 'product', 'lib64', 'libx+.so'), 'so')
  await writeFile(join(root, 'product', 'etc', 'build.prop'), '# c\nro.a=1\nro.b=2\n')
  await writeFile(
    join(root, 'config', 'product_fs_config'),
    [
      '/ 0 0 0755',
      'product/ 0 0 0755',
      'product/app 0 0 0755',
      'product/app/Foo 0 0 0755',
      'product/app/Foo/Foo.apk 0 0 0644',
      'product/lib64 0 0 0755',
      'product/lib64/libx+.so 0 0 0644',
      'product/etc 0 0 0755',
      'product/etc/build.prop 0 0 0600',
      ''
    ].join('\n')
  )
  await writeFile(
    join(root, 'config', 'product_file_contexts'),
    [
      '/ u:object_r:system_file:s0',
      '/product u:object_r:system_file:s0',
      '/product/ u:object_r:system_file:s0',
      '/product/app u:object_r:system_file:s0',
      '/product/app/Foo u:object_r:system_file:s0',
      '/product/app/Foo/Foo\\.apk u:object_r:system_file:s0',
      '/product/lib64 u:object_r:system_lib_file:s0',
      '/product/lib64/libx\\+\\.so u:object_r:system_lib_file:s0',
      '/product/etc u:object_r:system_file:s0',
      '/product/etc/build\\.prop u:object_r:system_file:s0',
      ''
    ].join('\n')
  )
  return root
}

describe('WorkTree', () => {
  it('round-trips the config files byte for byte when nothing changes', async () => {
    const root = await makeTree()
    const before = [
      readFileSync(join(root, 'config', 'product_fs_config'), 'utf8'),
      readFileSync(join(root, 'config', 'product_file_contexts'), 'utf8')
    ]
    const t = await WorkTree.open(root, ['product'])
    await t.save()
    expect(readFileSync(join(root, 'config', 'product_fs_config'), 'utf8')).toBe(before[0])
    expect(readFileSync(join(root, 'config', 'product_file_contexts'), 'utf8')).toBe(before[1])
  })

  it('removes a tree with its entries and adds files with inherited labels', async () => {
    const root = await makeTree()
    const t = await WorkTree.open(root, ['product'])
    await t.remove('product/app/Foo')
    expect(existsSync(join(root, 'product/app/Foo'))).toBe(false)
    await t.addFile('product/lib64/new/liby.so', Buffer.from('y'))
    await t.addFile('product/app/Bar/Bar.apk', Buffer.from('b'), { mode: 0o644 })
    await t.save()
    const fs = readFileSync(join(root, 'config', 'product_fs_config'), 'utf8')
    const ctx = readFileSync(join(root, 'config', 'product_file_contexts'), 'utf8')
    expect(fs).not.toMatch(/Foo/)
    expect(ctx).not.toMatch(/Foo/)
    expect(fs).toContain('product/lib64/new 0 0 0755\nproduct/lib64/new/liby.so 0 0 0644')
    expect(ctx).toContain('/product/lib64/new/liby\\.so u:object_r:system_lib_file:s0')
    expect(ctx).toContain('/product/app/Bar/Bar\\.apk u:object_r:system_file:s0')
    // Untouched quirky lines are kept as written.
    expect(ctx).toContain('/product/ u:object_r:system_file:s0')
    expect(fs).toContain('product/ 0 0 0755')
    expect([...t.removed]).toEqual(['product/app/Foo'])
  })

  it('refuses paths outside the partitions and duplicate files', async () => {
    const root = await makeTree()
    const t = await WorkTree.open(root, ['product'])
    expect(() => t.abs('vendor/x')).toThrow(/not inside/)
    expect(() => t.abs('product/../../x')).toThrow()
    await expect(t.addFile('product/etc/build.prop', Buffer.from('x'))).rejects.toThrow(/exists/)
    await expect(t.remove('product/nope')).rejects.toThrow(/does not exist/)
  })

  it('escapes context paths like extract.erofs', () => {
    expect(escapeContextPath('/system/bin/[')).toBe('/system/bin/\\[')
    expect(escapeContextPath('/a/lost+found/b.so')).toBe('/a/lost\\+found/b\\.so')
    expect(unescapeContextPath('/a/lost\\+found/b\\.so')).toBe('/a/lost+found/b.so')
  })
})

describe('file operations', () => {
  it('edits props in place and appends new keys', () => {
    expect(editProps('# c\nro.a=1\nro.b=2\n', { 'ro.a': '9', 'ro.c': '3' }, ['ro.b'])).toBe(
      '# c\nro.a=9\n\n# Added by HyperKitchen\nro.c=3\n'
    )
  })

  it('drops whole XML lines only', () => {
    const xml =
      '<permissions>\n    <feature name="cn.google.services" />\n    <feature name="other" />\n</permissions>\n'
    const r = dropLines(xml, [/<feature\s+name="cn\.google\.services"\s*\/>/])
    expect(r).toEqual({
      text: '<permissions>\n    <feature name="other" />\n</permissions>\n',
      dropped: 1
    })
  })

  it('removes an app folder, or only the file when the APK shares a folder', () => {
    expect(apkRemovalTarget('product/app/Foo/Foo.apk')).toBe('product/app/Foo')
    expect(apkRemovalTarget('product/overlay/FooOverlay.apk')).toBe(
      'product/overlay/FooOverlay.apk'
    )
  })

  it('validates recipes', () => {
    expect(() =>
      RecipeSchema.parse({
        schema: 1,
        operations: [{ id: 'x', type: 'remove-paths', params: { paths: ['/etc'] } }]
      })
    ).toThrow()
    expect(() =>
      RecipeSchema.parse({
        schema: 1,
        operations: [{ id: 'x', type: 'disable-encryption', params: { acknowledged: false } }]
      })
    ).toThrow()
    const r = RecipeSchema.parse({
      schema: 1,
      operations: [{ id: 'x', type: 'unlock-cn-gms', params: {} }]
    })
    expect(r.operations[0]).toMatchObject({ enabled: true, params: { includeGnss: false } })
  })
})

describe('smali rules', () => {
  const smali = [
    '.class public Lcom/x/A;',
    '',
    '.method private static f()Z',
    '    .locals 1',
    '',
    '    sget-boolean v0, Lmiui/os/Build;->IS_INTERNATIONAL_BUILD:Z',
    '',
    '    if-eqz v0, :cond_0',
    '',
    '    sput-boolean v0, Lcom/x/A;->CN:Z',
    '',
    '    return v0',
    '.end method',
    '',
    '.method public g()V',
    '    .locals 2',
    '',
    '    sget-boolean v1, Lmiui/os/Build;->IS_INTERNATIONAL_BUILD:Z',
    '',
    '    return-void',
    '.end method',
    ''
  ].join('\n')
  const F = 'Lmiui/os/Build;->IS_INTERNATIONAL_BUILD:Z'

  it('forces a static boolean read only inside the named method', () => {
    const out = applyRule(smali, {
      kind: 'force-sget',
      cls: 'com/x/A',
      method: 'f()Z',
      field: F,
      value: 1,
      expect: 1
    })
    expect(out).toContain(`    sget-boolean v0, ${F}\n\n    const/4 v0, 0x1\n\n    if-eqz`)
    expect(out).toContain(`    sget-boolean v1, ${F}\n\n    return-void`)
  })

  it('fails when the match count differs', () => {
    expect(() =>
      applyRule(smali, {
        kind: 'force-sget',
        cls: 'com/x/A',
        method: 'f()Z',
        field: F,
        value: 1,
        expect: 2
      })
    ).toThrow(/1 matches, expected 2/)
    expect(() =>
      applyRule(smali, {
        kind: 'force-sget',
        cls: 'com/x/A',
        method: 'h()V',
        field: F,
        value: 1,
        expect: 1
      })
    ).toThrow(/not found/)
  })

  it('handles sput, return and stubs (static without params gets a local)', () => {
    const a = applyRule(smali, {
      kind: 'force-sput',
      cls: 'com/x/A',
      method: 'f()Z',
      field: 'Lcom/x/A;->CN:Z',
      value: 0,
      expect: 1
    })
    expect(a).toContain('    const/4 v0, 0x0\n\n    sput-boolean v0, Lcom/x/A;->CN:Z')
    const b = applyRule(smali, {
      kind: 'force-return',
      cls: 'com/x/A',
      method: 'f()Z',
      value: 0,
      expect: 1
    })
    expect(b).toContain('    const/4 v0, 0x0\n\n    return v0')
    const c = applyRule(smali, { kind: 'stub', cls: 'com/x/A', method: 'f()Z', returns: 1 })
    expect(c).toContain(
      '.method private static f()Z\n    .locals 1\n\n    const/4 v0, 0x1\n\n    return v0\n.end method'
    )
    const d = applyRule(smali, { kind: 'stub', cls: 'com/x/A', method: 'g()V', returns: 'void' })
    expect(d).toContain('.method public g()V\n    .locals 0\n\n    return-void\n.end method')
  })

  it('normalises only assembler artefacts in the rebuild gate', () => {
    const a =
      '    .locals 1\n\n    nop\n\n    :sswitch_data_0\n.field private static final x:Z = false\n'
    const b = '    .locals 1\n    :sswitch_data_0\n.field private static final x:Z\n'
    expect(normalizeSmali(a)).toBe(normalizeSmali(b))
    expect(normalizeSmali('    nop\n    return-void')).not.toBe(normalizeSmali('    return-void'))
    expect(normalizeSmali('.field private final x:Z = true')).toContain('= true')
  })

  it('maps tree paths to device paths', () => {
    expect(devicePath('system/system/framework/a.jar')).toBe('/system/framework/a.jar')
    expect(devicePath('system_ext/framework/a.jar')).toBe('/system_ext/framework/a.jar')
  })

  it('keeps patch set ids unique and every rule complete', () => {
    const ids = PATCH_SETS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of PATCH_SETS) {
      for (const t of s.targets) {
        expect(t.verifiedSha256).toMatch(/^[0-9a-f]{64}$/)
        for (const r of t.rules) {
          if (r.kind === 'add-class') expect(r.smali).toContain(`.class public final L${r.cls};`)
          else if (r.kind !== 'stub') expect(r.expect).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('artifacts of a patched file', () => {
  it('lists odex/vdex/art and fs-verity metadata', async () => {
    const root = await makeTree()
    for (const f of [
      'product/framework/x.jar',
      'product/framework/x.jar.fsv_meta',
      'product/framework/oat/arm64/x.odex',
      'product/framework/oat/arm64/x.vdex.fsv_meta',
      'product/framework/oat/arm64/x.other.odex'
    ]) {
      await mkdir(join(root, f, '..'), { recursive: true })
      await writeFile(join(root, f), '')
    }
    const t = await WorkTree.open(root, ['product'])
    expect(artifactsOf(t, 'product/framework/x.jar').sort()).toEqual([
      'product/framework/oat/arm64/x.odex',
      'product/framework/oat/arm64/x.vdex.fsv_meta',
      'product/framework/x.jar.fsv_meta'
    ])
    expect(artifactsOf(t, 'product/app/Foo/Foo.apk')).toEqual([])
  })
})

describe('zip rewriter', () => {
  const cert = der(0x30, der(0x30, Buffer.from('cert')))

  it('copies untouched entries, replaces one and keeps the signing block', async () => {
    const src = join(tmp, 'in.apk')
    await writeFile(
      src,
      zip(
        [
          ['AndroidManifest.xml', Buffer.from('manifest')],
          ['classes.dex', Buffer.from('old dex')],
          ['res/raw.bin', Buffer.from('raw')]
        ],
        signingBlock([[0xf05368c0, schemeBlock(cert, true)]])
      )
    )
    const dst = join(tmp, 'out.apk')
    await rewriteZip(
      src,
      dst,
      new Map([['classes.dex', Buffer.from('new dex, longer than before')]])
    )
    const dataOffsets = async (f: string): Promise<Map<string, number>> => {
      const zf = await ZipFile.open(f)
      const m = new Map<string, number>()
      try {
        for (const e of zf.entries.values()) {
          const lh = await zf.readRange(e.localHeaderOffset, 30)
          m.set(e.name, e.localHeaderOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28))
        }
      } finally {
        await zf.close()
      }
      return m
    }
    const before = await dataOffsets(src)
    const after = await dataOffsets(dst)
    for (const [name, off] of before) {
      // Each stored entry keeps the alignment it had in the input.
      const align = [16384, 4096, 4].find((a) => off % a === 0) ?? 1
      expect((after.get(name) as number) % align, name).toBe(0)
    }
    const z = await ZipFile.open(dst)
    try {
      expect((await z.read('classes.dex'))?.toString()).toBe('new dex, longer than before')
      expect((await z.read('res/raw.bin'))?.toString()).toBe('raw')
      expect((await z.read('AndroidManifest.xml'))?.toString()).toBe('manifest')
      // The original signer is still readable (identity kept, content no longer signed).
      expect((await readSigner(z)).schemes).toEqual(['v3'])
    } finally {
      await z.close()
    }
    await expect(rewriteZip(src, dst, new Map([['nope', Buffer.alloc(1)]]))).rejects.toThrow(
      /no entry/
    )
    expect((await readFile(dst)).length).toBeGreaterThan(0)
  })

  it('builds alignment extras like apksig', () => {
    const e = alignedExtra(Buffer.alloc(0), 30 + 11, 4)
    expect(e.readUInt16LE(0)).toBe(0xd935)
    expect((30 + 11 + e.length) % 4).toBe(0)
    // Old zero padding and previous alignment records are dropped.
    const old = Buffer.concat([Buffer.from([0, 0, 0, 0]), e])
    expect(alignedExtra(old, 41, 4)).toEqual(e)
  })
})

describe('import-from-rom', () => {
  it('copies files with the exact metadata of the source ROM and refuses silent overwrites', async () => {
    // Source ROM: a project folder with stock/fs.
    const refProject = join(tmp, `ref${Math.random().toString(36).slice(2)}`)
    const refFs = await makeTree()
    await mkdir(join(refProject, 'stock'), { recursive: true })
    await rm(join(refProject, 'stock', 'fs'), { recursive: true, force: true })
    await writeFile(join(refFs, 'product', 'app', 'Foo', 'lib.so'), 'lib')
    const fsCfg = readFileSync(join(refFs, 'config', 'product_fs_config'), 'utf8')
    await writeFile(
      join(refFs, 'config', 'product_fs_config'),
      fsCfg + 'product/app/Foo/lib.so 0 2000 0750 capabilities=0x400\n'
    )
    const ctxCfg = readFileSync(join(refFs, 'config', 'product_file_contexts'), 'utf8')
    await writeFile(
      join(refFs, 'config', 'product_file_contexts'),
      ctxCfg + '/product/app/Foo/lib\\.so u:object_r:special_file:s0\n'
    )
    const { rename } = await import('node:fs/promises')
    await rename(refFs, join(refProject, 'stock', 'fs'))

    // Target without the app.
    const root = await makeTree()
    const t = await WorkTree.open(root, ['product'])
    await t.remove('product/app/Foo')
    const { FILE_OPS, newReport } = await import('../../src/worker/recipe/ops')
    const op = RecipeSchema.parse({
      schema: 1,
      operations: [
        {
          id: 'imp',
          type: 'import-from-rom',
          params: { project: refProject, paths: ['product/app/Foo'] }
        }
      ]
    }).operations[0]
    const r = newReport(op)
    await FILE_OPS['import-from-rom']!({ tree: t, apks: [], log: () => {} }, op, r)
    await t.save()
    expect(r.added.sort()).toEqual(['product/app/Foo/Foo.apk', 'product/app/Foo/lib.so'])
    expect(readFileSync(join(root, 'product/app/Foo/lib.so'), 'utf8')).toBe('lib')
    const fs = readFileSync(join(root, 'config', 'product_fs_config'), 'utf8')
    expect(fs).toContain('product/app/Foo/lib.so 0 2000 0750 capabilities=0x400')
    expect(readFileSync(join(root, 'config', 'product_file_contexts'), 'utf8')).toContain(
      '/product/app/Foo/lib\\.so u:object_r:special_file:s0'
    )
    // A second import of the same files must be explicit.
    const again = newReport(op)
    await expect(
      FILE_OPS['import-from-rom']!({ tree: t, apks: [], log: () => {} }, op, again)
    ).rejects.toThrow(/replace/)
  })
})

describe('full cleanup preset', () => {
  it('produces a valid recipe with unique ids and keeps encryption on', async () => {
    const { cleanupPreset } = await import('../../src/shared/presets')
    const r = RecipeSchema.parse({ schema: 1, operations: cleanupPreset() })
    const ids = r.operations.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    // The preset is our own debloat + stock patches; it imports nothing from another ROM.
    expect(r.operations.some((o) => o.type === 'import-from-rom')).toBe(false)
    expect(r.operations.some((o) => o.type === 'disable-encryption')).toBe(false)
  })
})

describe('spec-card operation', () => {
  it('writes device_info.json, dropping empty values, and validates the schema', async () => {
    const root = await makeTree()
    const tree = await WorkTree.open(root, ['product'])
    const op = OperationSchema.parse({
      id: 'sc',
      type: 'spec-card',
      params: {
        entries: [
          {
            hwc: ['CN', 'IN'],
            basic: { cpu: 'SD 8s Gen 4', battery: '7550mAh', screen: '', resolution: '2772x1280' },
            camera: { rear_camera: '50MP+8MP', front_camera: '' }
          },
          { hwc: 'GL', basic: { cpu: 'SD 8s Gen 4' }, camera: {} }
        ]
      }
    })
    const r = newReport(op)
    await FILE_OPS['spec-card']!({ tree, apks: [], log: () => {} }, op, r)
    await tree.save()
    expect(r.added).toContain('product/etc/device_info.json')
    const json = JSON.parse(readFileSync(join(root, 'product/etc/device_info.json'), 'utf8'))
    expect(json).toEqual([
      {
        hwc: ['CN', 'IN'],
        basic: { cpu: 'SD 8s Gen 4', battery: '7550mAh', resolution: '2772x1280' },
        camera: { rear_camera: '50MP+8MP' }
      },
      { hwc: 'GL', basic: { cpu: 'SD 8s Gen 4' } }
    ])
    // The new file inherits product/etc's owner/mode and SELinux label.
    const fsConfig = readFileSync(join(root, 'config/product_fs_config'), 'utf8')
    expect(fsConfig).toContain('product/etc/device_info.json 0 0 0644')
    const ctx = readFileSync(join(root, 'config/product_file_contexts'), 'utf8')
    expect(ctx).toContain('/product/etc/device_info\\.json u:object_r:system_file:s0')

    // Running again replaces the file (modified, not added twice).
    const tree2 = await WorkTree.open(root, ['product'])
    const r2 = newReport(op)
    await FILE_OPS['spec-card']!({ tree: tree2, apks: [], log: () => {} }, op, r2)
    expect(r2.modified).toContain('product/etc/device_info.json')
    expect(r2.added).not.toContain('product/etc/device_info.json')
  })
})

describe('device-feature operation', () => {
  it('flips a bool and sets an integer in a device_features xml, erroring on a missing flag', async () => {
    const dir = join(tmp, `df${Math.random().toString(36).slice(2)}`)
    await mkdir(join(dir, 'config'), { recursive: true })
    await mkdir(join(dir, 'product/etc/device_features'), { recursive: true })
    const xml =
      '<features>\n  <bool name="support_aod_fullscreen">false</bool>\n  <integer name="defaultFps">60</integer>\n</features>\n'
    await writeFile(join(dir, 'product/etc/device_features/onyx.xml'), xml)
    await writeFile(
      join(dir, 'config/product_fs_config'),
      ['/ 0 0 0755', 'product 0 0 0755', 'product/etc/device_features/onyx.xml 0 0 0644', ''].join(
        '\n'
      )
    )
    await writeFile(
      join(dir, 'config/product_file_contexts'),
      ['/ u:object_r:system_file:s0', '', ''].join('\n')
    )
    const { FILE_OPS, newReport } = await import('../../src/worker/recipe/ops')
    const tree = await WorkTree.open(dir, ['product'])
    const op = RecipeSchema.parse({
      schema: 1,
      operations: [
        {
          id: 'f',
          type: 'device-feature',
          enabled: true,
          params: {
            file: 'product/etc/device_features/onyx.xml',
            bools: { support_aod_fullscreen: true },
            ints: { defaultFps: 120 }
          }
        }
      ]
    }).operations[0]
    await FILE_OPS['device-feature']!({ tree, apks: [], log: () => {} }, op, newReport(op))
    const out = readFileSync(join(dir, 'product/etc/device_features/onyx.xml'), 'utf8')
    expect(out).toContain('<bool name="support_aod_fullscreen">true</bool>')
    expect(out).toContain('<integer name="defaultFps">120</integer>')

    const bad = RecipeSchema.parse({
      schema: 1,
      operations: [
        {
          id: 'g',
          type: 'device-feature',
          enabled: true,
          params: {
            file: 'product/etc/device_features/onyx.xml',
            bools: { not_a_real_flag: true },
            ints: {}
          }
        }
      ]
    }).operations[0]
    const t2 = await WorkTree.open(dir, ['product'])
    await expect(
      FILE_OPS['device-feature']!({ tree: t2, apks: [], log: () => {} }, bad, newReport(bad))
    ).rejects.toThrow(/no <bool name="not_a_real_flag">/)
  })
})
