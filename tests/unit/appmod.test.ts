// App mods: zip entry add/remove, decode diff and overlay, smali stubs, string resources, the
// public.xml ID gate and resource package IDs.
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OperationSchema } from '../../src/shared/recipe'
import { renderAdbBatch, renderAdbScript } from '../../src/worker/appmod/adbpack'
import { arscPackageIds } from '../../src/worker/appmod/frameworks'
import { applyOverlay, diffDecoded } from '../../src/worker/appmod/mod'
import { classify, entryOf, publicIdChange, sameLineSet } from '../../src/worker/appmod/rebuild'
import { keytoolFor, parseVerify } from '../../src/worker/appmod/sign'
import { listMethods, stubMethod, stubValues } from '../../src/worker/appmod/smali'
import {
  escapeString,
  listStrings,
  removeString,
  setString,
  unescapeString
} from '../../src/worker/appmod/strings'
import { readSigner } from '../../src/worker/formats/apksig'
import { ZipFile } from '../../src/worker/formats/zip'
import { rewriteZip } from '../../src/worker/formats/zipwrite'
import { der, schemeBlock, signingBlock, zip } from '../fixtures/apk'

let tmp: string
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hk-appmod-'))
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe('zip rewriter: add and remove entries', () => {
  it('drops entries, appends new ones aligned and keeps the signing block', async () => {
    const src = join(tmp, 'in.apk')
    const cert = der(0x30, der(0x30, Buffer.from('cert')))
    await writeFile(
      src,
      zip(
        [
          ['AndroidManifest.xml', Buffer.from('old manifest')],
          ['classes.dex', Buffer.from('dex')],
          ['res/a.xml', Buffer.from('a')],
          ['res/b.png', Buffer.from('b')],
          ['resources.arsc', Buffer.from('old arsc')]
        ],
        signingBlock([[0x7109871a, schemeBlock(cert, false)]])
      )
    )
    const dst = join(tmp, 'out.apk')
    const isRes = (n: string): boolean =>
      n === 'AndroidManifest.xml' || n === 'resources.arsc' || n.startsWith('res/')
    await rewriteZip(src, dst, new Map(), {
      remove: isRes,
      add: [
        { name: 'AndroidManifest.xml', data: Buffer.from('new manifest'), compress: true },
        { name: 'resources.arsc', data: Buffer.from('new arsc'), compress: false },
        { name: 'res/xY.xml', data: Buffer.from('renamed '.repeat(50)), compress: true },
        { name: 'lib/arm64-v8a/libx.so', data: Buffer.from('elf'), compress: false }
      ]
    })
    const z = await ZipFile.open(dst)
    try {
      expect([...z.entries.keys()]).toEqual([
        'classes.dex',
        'AndroidManifest.xml',
        'resources.arsc',
        'res/xY.xml',
        'lib/arm64-v8a/libx.so'
      ])
      expect((await z.read('AndroidManifest.xml'))?.toString()).toBe('new manifest')
      expect((await z.read('res/xY.xml'))?.toString()).toBe('renamed '.repeat(50))
      const arsc = z.entries.get('resources.arsc')!
      expect(arsc.method).toBe(0)
      const so = z.entries.get('lib/arm64-v8a/libx.so')!
      const dataAt = async (e: typeof arsc): Promise<number> => {
        const lh = await z.readRange(e.localHeaderOffset, 30)
        return e.localHeaderOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)
      }
      expect((await dataAt(arsc)) % 4).toBe(0)
      expect((await dataAt(so)) % 16384).toBe(0)
      expect(z.entries.get('res/xY.xml')!.method).toBe(8)
      expect((await readSigner(z)).schemes).toEqual(['v2'])
    } finally {
      await z.close()
    }
    // A standard tool accepts the result (CRCs, sizes, central directory).
    const t = spawnSync('unzip', ['-tq', dst], { encoding: 'utf8' })
    expect(t.stdout + t.stderr).toMatch(/No errors detected/)
    await expect(
      rewriteZip(src, dst, new Map(), {
        add: [{ name: 'classes.dex', data: Buffer.alloc(1), compress: false }]
      })
    ).rejects.toThrow(/already exists/)
  })
})

describe('decode diff and overlay', () => {
  it('records modified, added and deleted files and applies them onto a fresh decode', async () => {
    const base = join(tmp, 'base')
    const edit = join(tmp, 'edit')
    for (const d of [base, edit]) {
      await mkdir(join(d, 'smali/com/x'), { recursive: true })
      await mkdir(join(d, 'res/values'), { recursive: true })
      await writeFile(join(d, 'apktool.yml'), 'version: 1\n')
      await writeFile(join(d, 'smali/com/x/A.smali'), '.class A\n')
      await writeFile(join(d, 'smali/com/x/Gone.smali'), '.class Gone\n')
      await writeFile(join(d, 'res/values/strings.xml'), '<resources/>\n')
    }
    const t = new Date('2020-01-01T00:00:00Z')
    for (const d of [base, edit]) {
      for (const f of ['smali/com/x/A.smali', 'smali/com/x/Gone.smali', 'res/values/strings.xml'])
        await utimes(join(d, f), t, t)
    }
    await writeFile(join(edit, 'smali/com/x/A.smali'), '.class A\n# edited\n')
    await rm(join(edit, 'smali/com/x/Gone.smali'))
    await writeFile(join(edit, 'smali/com/x/New.smali'), '.class New\n')
    await writeFile(join(edit, 'apktool.yml'), 'version: 2\n') // apktool metadata is ignored
    const changes = await diffDecoded(base, edit, new AbortController().signal)
    expect(changes.map((c) => `${c.kind} ${c.path}`)).toEqual([
      'modified smali/com/x/A.smali',
      'deleted smali/com/x/Gone.smali',
      'added smali/com/x/New.smali'
    ])

    const overlay = join(tmp, 'overlay')
    await mkdir(join(overlay, 'smali/com/x'), { recursive: true })
    await writeFile(join(overlay, 'smali/com/x/A.smali'), '.class A\n# edited\n')
    await writeFile(join(overlay, 'smali/com/x/New.smali'), '.class New\n')
    const fresh = join(tmp, 'fresh')
    await mkdir(fresh)
    spawnSync('cp', ['-R', base + '/', fresh])
    const applied = await applyOverlay(fresh, overlay, changes)
    expect(applied.map((a) => a.path)).toEqual(changes.map((c) => c.path))
    expect(await readFile(join(fresh, 'smali/com/x/A.smali'), 'utf8')).toContain('# edited')

    // A decode that differs from the one the mod was made on is refused.
    await writeFile(join(base, 'smali/com/x/A.smali'), '.class A\n# new upstream\n')
    await expect(applyOverlay(base, overlay, changes)).rejects.toThrow(/differs from the one/)
  })

  it('classifies decoded paths into dex, resources and raw entries', () => {
    const c = classify(
      [
        { path: 'smali_classes2/a/B.smali', data: Buffer.from('') },
        { path: 'res/values/strings.xml', data: Buffer.from('') },
        { path: 'assets/ads.json', data: null },
        { path: 'unknown/kotlin/x.kotlin_builtins', data: Buffer.from('k') }
      ],
      true
    )
    expect([...c.smaliDirs]).toEqual(['smali_classes2'])
    expect(c.resources).toBe(true)
    expect([...c.raw.keys()]).toEqual(['assets/ads.json', 'kotlin/x.kotlin_builtins'])
    // Without a resource decode, res/ files are raw zip entries.
    expect(entryOf('res/drawable/x.png', false)).toBe('res/drawable/x.png')
    expect(entryOf('res/drawable/x.png', true)).toBeNull()
    expect(() => classify([{ path: 'apktool.yml', data: null }], true)).toThrow(/metadata/)
  })
})

describe('resource gate', () => {
  const pub = (rows: string[]): string =>
    `<resources>\n${rows.map((r) => `    ${r}`).join('\n')}\n</resources>\n`
  it('accepts appended IDs for new resources only', () => {
    const before = pub([
      '<public type="string" name="a" id="0x7f010000" />',
      '<public type="string" name="b" id="0x7f010001" />'
    ])
    const added = pub([
      '<public type="string" name="a" id="0x7f010000" />',
      '<public type="string" name="b" id="0x7f010001" />',
      '<public type="string" name="hk_new" id="0x7f010002" />'
    ])
    expect(publicIdChange(before, added)).toBeNull()
    const moved = pub([
      '<public type="string" name="a" id="0x7f010001" />',
      '<public type="string" name="b" id="0x7f010000" />'
    ])
    expect(publicIdChange(before, moved)).toMatch(/string\/a/)
    expect(
      publicIdChange(before, pub(['<public type="string" name="a" id="0x7f010000" />']))
    ).toMatch(/missing/)
  })
  it('treats reordered values items as equal', () => {
    expect(sameLineSet('<a>\n  <x/>\n  <y/>\n</a>', '<a>\n  <y/>\n  <x/>\n</a>')).toBe(true)
    expect(sameLineSet('<a>\n  <x/>\n</a>', '<a>\n  <y/>\n</a>')).toBe(false)
  })
})

describe('smali stubs', () => {
  const cls = [
    '.class public Lcom/x/AdUtil;',
    '.super Ljava/lang/Object;',
    '',
    '.method private static isShowAd()Z',
    '    .locals 1',
    '',
    '    sget-boolean v0, Lcom/x/Config;->IS_GLOBAL:Z',
    '',
    '    return v0',
    '.end method',
    '',
    '.method public load(Ljava/lang/String;)Ljava/util/List;',
    '    .locals 2',
    '    .annotation system Ldalvik/annotation/Signature;',
    '        value = {',
    '            "(Ljava/lang/String;)Ljava/util/List<Ljava/lang/String;>;"',
    '        }',
    '    .end annotation',
    '',
    '    new-instance v0, Ljava/util/ArrayList;',
    '    return-object v0',
    '.end method',
    '',
    '.method public abstract show()V',
    '.end method',
    '',
    '.method public static time()J',
    '    .locals 2',
    '    invoke-static {}, Ljava/lang/System;->currentTimeMillis()J',
    '    move-result-wide v0',
    '    return-wide v0',
    '.end method',
    ''
  ].join('\n')

  it('lists methods with their return types', () => {
    expect(listMethods(cls).map((m) => `${m.sig} ${m.returnType}`)).toEqual([
      'isShowAd()Z Z',
      'load(Ljava/lang/String;)Ljava/util/List; Ljava/util/List;',
      'show()V V',
      'time()J J'
    ])
    expect(stubValues('Z')).toEqual([0, 1])
    expect(stubValues('Ljava/util/List;')).toEqual(['null'])
  })

  it('replaces bodies by return type and keeps annotations', () => {
    const a = stubMethod(cls, 'isShowAd()Z', 0)
    expect(a).toContain(
      '.method private static isShowAd()Z\n    .locals 1\n\n    const/4 v0, 0x0\n\n    return v0\n.end method'
    )
    expect(a).not.toContain('IS_GLOBAL')
    const b = stubMethod(cls, 'load(Ljava/lang/String;)Ljava/util/List;', 'null')
    expect(b).toContain(
      '.end annotation\n\n    .locals 1\n\n    const/4 v0, 0x0\n\n    return-object v0\n.end method'
    )
    expect(b).toContain('Ljava/util/List<Ljava/lang/String;>;')
    expect(b).not.toContain('ArrayList')
    expect(stubMethod(cls, 'time()J', 0)).toContain('const-wide/16 v0, 0x0\n\n    return-wide v0')
    expect(() => stubMethod(cls, 'show()V', 'void')).toThrow(/no body/)
    expect(() => stubMethod(cls, 'isShowAd()Z', 'null')).toThrow(/not a valid value/)
    expect(() => stubMethod(cls, 'nope()V', 'void')).toThrow(/not found/)
    // Everything else is untouched.
    expect(a.split('.method public load')[1]).toBe(cls.split('.method public load')[1])
  })
})

describe('string resources', () => {
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">File Manager</string>\n    <string name="fmt" formatted="false">%s &amp; %d\\\'s</string>\n    <string name="empty" />\n</resources>\n'

  it('lists and unescapes', () => {
    const s = listStrings(xml)
    expect(s.map((x) => x.name)).toEqual(['app_name', 'fmt', 'empty'])
    expect(s[1].value).toBe("%s & %d's")
    expect(s[1].attrs).toBe('formatted="false"')
    expect(s[2].value).toBe('')
  })

  it('edits, adds and removes with Android escaping', () => {
    const v = 'Tom\'s "best" <b> & @home\nline'
    expect(unescapeString(escapeString(v))).toBe(v)
    expect(escapeString('@string/x')).toBe('\\@string/x')
    const a = setString(xml, 'app_name', 'Files & more')
    expect(a).toContain('<string name="app_name">Files &amp; more</string>')
    const b = setString(xml, 'fmt', "it's")
    expect(b).toContain('<string name="fmt" formatted="false">it\\\'s</string>')
    const c = setString(xml, 'hk_rom_name', 'HyperKitchen')
    expect(c).toContain('    <string name="hk_rom_name">HyperKitchen</string>\n</resources>')
    expect(listStrings(c)).toHaveLength(4)
    expect(removeString(c, 'hk_rom_name')).toBe(xml)
    expect(() => setString(xml, 'bad name', 'x')).toThrow(/invalid/)
  })
})

describe('frameworks and recipe', () => {
  it('reads package IDs from resources.arsc chunks', () => {
    const chunk = (type: number, hdr: number, body: Buffer): Buffer => {
      const h = Buffer.alloc(8)
      h.writeUInt16LE(type, 0)
      h.writeUInt16LE(hdr, 2)
      h.writeUInt32LE(8 + body.length, 4)
      return Buffer.concat([h, body])
    }
    const pool = chunk(0x0001, 28, Buffer.alloc(20))
    const pkg = (id: number): Buffer => {
      const b = Buffer.alloc(16)
      b.writeUInt32LE(id, 0)
      return chunk(0x0200, 288, b)
    }
    const head = Buffer.alloc(12)
    head.writeUInt16LE(0x0002, 0)
    head.writeUInt16LE(12, 2)
    head.writeUInt32LE(2, 8)
    const table = Buffer.concat([head, pool, pkg(0x12), pkg(0x7f)])
    table.writeUInt32LE(table.length, 4)
    expect(arscPackageIds(table)).toEqual([0x12, 0x7f])
    expect(arscPackageIds(Buffer.from('nope, not a table'))).toEqual([])
  })

  it('validates app-mod operations', () => {
    expect(
      OperationSchema.parse({
        id: 'm',
        type: 'app-mod',
        params: { mod: 'com.android.fileexplorer' }
      }).enabled
    ).toBe(true)
    expect(() =>
      OperationSchema.parse({ id: 'm', type: 'app-mod', params: { mod: '../x' } })
    ).toThrow()
  })
})

describe('adb package', () => {
  const verifyOut = [
    'Verifies',
    'Verified using v1 scheme (JAR signing): false',
    'Verified using v2 scheme (APK Signature Scheme v2): true',
    'Verified using v3 scheme (APK Signature Scheme v3): true',
    'Number of signers: 1',
    'V3.0 Signer: certificate DN: CN=HyperKitchen project x',
    `V3.0 Signer: certificate SHA-256 digest: ${'ab'.repeat(32)}`
  ].join('\n')

  it('reads apksigner verify output', () => {
    expect(parseVerify(verifyOut)).toEqual({ certSha256: 'ab'.repeat(32), schemes: ['v2', 'v3'] })
    expect(() => parseVerify('DOES NOT VERIFY\nERROR: digest mismatch')).toThrow(/verify/)
    expect(() => parseVerify(verifyOut.replace('signers: 1', 'signers: 2'))).toThrow(/one signer/)
  })

  it('finds keytool next to java', () => {
    expect(keytoolFor('/opt/jre/bin/java')).toBe('/opt/jre/bin/keytool')
    expect(keytoolFor('java')).toBe('keytool')
  })

  it('writes scripts that check the device, ask, and explain signer conflicts', async () => {
    const o = {
      device: 'onyx',
      packageName: 'com.android.fileexplorer',
      apk: "it's.apk",
      generator: 'HK test'
    }
    for (const os of ['macos', 'linux'] as const) {
      const sh = renderAdbScript({ ...o, os })
      const f = join(tmp, `${os}.sh`)
      await writeFile(f, sh)
      expect(spawnSync('sh', ['-n', f]).status).toBe(0)
      expect(sh).toContain(`ADB='bin/${os}/adb'`)
      expect(sh).toContain("install -r 'it'\\''s.apk'")
      expect(sh).toContain('[ "$dev" = \'onyx\' ]')
      expect(sh).toContain('UPDATE_INCOMPATIBLE')
      expect(sh).toContain('adb uninstall com.android.fileexplorer')
      expect(sh).not.toMatch(/\$ADB \$OPTS uninstall/) // never uninstalls by itself
      expect(sh.includes('xattr -d com.apple.quarantine')).toBe(os === 'macos')
    }
    const bat = renderAdbBatch(o)
    expect(bat).toContain('bin\\windows\\adb.exe')
    expect(bat).toContain('install -r "it\'s.apk"')
    expect(bat.split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
    expect(bat).not.toMatch(/%adb% uninstall/)
  })
})

describe('smali gate normalization', () => {
  it('treats const-string and const-string/jumbo alike', async () => {
    const { normalizeSmali } = await import('../../src/worker/appmod/rebuild')
    expect(normalizeSmali('    const-string/jumbo v0, "x"')).toBe(
      normalizeSmali('    const-string v0, "x"')
    )
    expect(normalizeSmali('    const-string v0, "x"')).not.toBe(
      normalizeSmali('    const-string v0, "y"')
    )
  })
})

describe('wrap-call rule', () => {
  it('passes a call result through a helper and counts matches', async () => {
    const { applyRule } = await import('../../src/worker/recipe/patcher')
    const call = 'Lcom/x/U;->ver(Landroid/content/Context;)Ljava/lang/String;'
    const helper = 'Lcom/hyperkitchen/Brand;->apply(Ljava/lang/String;)Ljava/lang/String;'
    const cls = [
      '.method public refresh()V',
      '    .locals 1',
      '',
      `    invoke-static {v0}, ${call}`,
      '',
      '    move-result-object v0',
      '',
      '    iput-object v0, p0, Lcom/x/Card;->name:Ljava/lang/String;',
      '',
      '    return-void',
      '.end method',
      ''
    ].join('\n')
    const rule = {
      kind: 'wrap-call' as const,
      cls: 'com/x/Card',
      method: 'refresh()V',
      call,
      helper,
      expect: 1
    }
    const out = applyRule(cls, rule)
    expect(out).toContain(
      `    move-result-object v0\n\n    invoke-static {v0}, ${helper}\n\n    move-result-object v0\n\n    iput-object`
    )
    expect(() => applyRule(cls, { ...rule, expect: 2 })).toThrow(/1 matches, expected 2/)
  })
})
