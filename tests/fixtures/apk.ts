// Builders for synthetic APK fixtures: binary XML manifest (ResourceTypes.h), stored-only ZIP
// (APPNOTE 4.3), APK Signing Block (apksig) and DER. Shared by unit and e2e tests.

import { crc32 } from 'node:zlib'

/** Tiny AXML encoder following ResourceTypes.h, enough for manifest tests. */
export function axml(
  elements: Array<{
    name: string
    attrs: Array<{ ns?: string; name: string; resId?: number; str?: string; int?: number }>
    children?: number
  }>
): Buffer {
  const ANDROID = 'http://schemas.android.com/apk/res/android'
  // Attribute names with resource ids must come first so their index maps into the resource map.
  const withId = [
    ...new Set(elements.flatMap((e) => e.attrs.filter((a) => a.resId).map((a) => a.name)))
  ]
  const strings: string[] = [...withId]
  const idx = (s: string): number => {
    let i = strings.indexOf(s)
    if (i < 0) i = strings.push(s) - 1
    return i
  }
  const resIds = withId.map(
    (n) => elements.flatMap((e) => e.attrs).find((a) => a.name === n)!.resId as number
  )
  const body: Buffer[] = []
  const stack: number[] = []
  for (const el of elements) {
    const attrs = el.attrs.map((a) => {
      const b = Buffer.alloc(20)
      b.writeUInt32LE(a.ns ? idx(ANDROID) : 0xffffffff, 0)
      b.writeUInt32LE(idx(a.name), 4)
      b.writeUInt32LE(a.str !== undefined ? idx(a.str) : 0xffffffff, 8)
      b.writeUInt16LE(8, 12)
      b[15] = a.str !== undefined ? 0x03 : 0x10
      b.writeUInt32LE(a.str !== undefined ? idx(a.str) : (a.int as number) >>> 0, 16)
      return b
    })
    const ext = Buffer.alloc(20)
    ext.writeUInt32LE(0xffffffff, 0)
    ext.writeUInt32LE(idx(el.name), 4)
    ext.writeUInt16LE(20, 8)
    ext.writeUInt16LE(20, 10)
    ext.writeUInt16LE(attrs.length, 12)
    const node = Buffer.alloc(16)
    node.writeUInt16LE(0x0102, 0)
    node.writeUInt16LE(16, 2)
    node.writeUInt32LE(16 + 20 + attrs.length * 20, 4)
    node.writeUInt32LE(0xffffffff, 12)
    body.push(node, ext, ...attrs)
    stack.push(el.children ?? 0)
    // Close elements whose children are done.
    while (stack.length && stack[stack.length - 1] === 0) {
      stack.pop()
      const end = Buffer.alloc(24)
      end.writeUInt16LE(0x0103, 0)
      end.writeUInt16LE(16, 2)
      end.writeUInt32LE(24, 4)
      end.writeUInt32LE(0xffffffff, 12)
      end.writeUInt32LE(0xffffffff, 16)
      body.push(end)
      if (stack.length) stack[stack.length - 1]--
    }
  }
  // UTF-16 string pool.
  const data = Buffer.concat(
    strings.map((s) => {
      const b = Buffer.alloc(2 + s.length * 2 + 2)
      b.writeUInt16LE(s.length, 0)
      b.write(s, 2, 'utf16le')
      return b
    })
  )
  const pad = (4 - (data.length % 4)) % 4
  const offsets = Buffer.alloc(strings.length * 4)
  let o = 0
  strings.forEach((s, i) => {
    offsets.writeUInt32LE(o, i * 4)
    o += 2 + s.length * 2 + 2
  })
  const sp = Buffer.alloc(28)
  sp.writeUInt16LE(0x0001, 0)
  sp.writeUInt16LE(28, 2)
  sp.writeUInt32LE(28 + offsets.length + data.length + pad, 4)
  sp.writeUInt32LE(strings.length, 8)
  sp.writeUInt32LE(28 + offsets.length, 20)
  const pool = Buffer.concat([sp, offsets, data, Buffer.alloc(pad)])
  const rm = Buffer.alloc(8 + resIds.length * 4)
  rm.writeUInt16LE(0x0180, 0)
  rm.writeUInt16LE(8, 2)
  rm.writeUInt32LE(rm.length, 4)
  resIds.forEach((id, i) => rm.writeUInt32LE(id, 8 + i * 4))
  const inner = Buffer.concat([pool, rm, ...body])
  const head = Buffer.alloc(8)
  head.writeUInt16LE(0x0003, 0)
  head.writeUInt16LE(8, 2)
  head.writeUInt32LE(8 + inner.length, 4)
  return Buffer.concat([head, inner])
}

export const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
export const u64 = (n: number): Buffer => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}
export const lp = (b: Buffer): Buffer => Buffer.concat([u32(b.length), b])

/** Stored-only zip with an optional APK Signing Block before the central directory. */
export function zip(files: Array<[string, Buffer]>, sigBlock?: Buffer): Buffer {
  const locals: Buffer[] = []
  const cds: Buffer[] = []
  let off = 0
  for (const [name, data] of files) {
    const n = Buffer.from(name)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt32LE(crc32(data) >>> 0, 14)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(n.length, 26)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt32LE(crc32(data) >>> 0, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(n.length, 28)
    cd.writeUInt32LE(off, 42)
    locals.push(lh, n, data)
    cds.push(cd, n)
    off += 30 + n.length + data.length
  }
  const sig = sigBlock ?? Buffer.alloc(0)
  const cd = Buffer.concat(cds)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(off + sig.length, 16)
  return Buffer.concat([...locals, sig, cd, eocd])
}

export function signingBlock(pairs: Array<[number, Buffer]>): Buffer {
  const body = Buffer.concat(pairs.map(([id, v]) => Buffer.concat([u64(v.length + 4), u32(id), v])))
  const size = body.length + 8 + 16
  return Buffer.concat([u64(size), body, u64(size), Buffer.from('APK Sig Block 42')])
}

/** v2/v3 scheme block with one signer holding the given certificate. */
export function schemeBlock(cert: Buffer, v3: boolean): Buffer {
  const signedData = Buffer.concat([
    lp(Buffer.alloc(0)), // digests
    lp(lp(cert)), // certificates
    ...(v3 ? [u32(28), u32(0x7fffffff)] : []),
    lp(Buffer.alloc(0)) // additional attributes
  ])
  const signer = Buffer.concat([
    lp(signedData),
    ...(v3 ? [u32(28), u32(0x7fffffff)] : []),
    lp(Buffer.alloc(0)),
    lp(Buffer.alloc(0))
  ])
  return lp(lp(signer))
}

/** DER TLV helper. */
export function der(tag: number, ...content: Buffer[]): Buffer {
  const c = Buffer.concat(content)
  const len =
    c.length < 0x80
      ? Buffer.from([c.length])
      : c.length < 0x100
        ? Buffer.from([0x81, c.length])
        : Buffer.from([0x82, c.length >> 8, c.length & 0xff])
  return Buffer.concat([Buffer.from([tag]), len, c])
}

/** A minimal resources.arsc that declares the given locales (e.g. ['en-US','zh-CN']). Only the
 * chunk headers and ResTable_config language/country bytes are valid, enough for arscLocales. */
export function arscWithLocales(locales: string[]): Buffer {
  const types: Buffer[] = []
  for (const loc of locales) {
    const [lang, country = ''] = loc.split('-')
    const t = Buffer.alloc(32)
    t.writeUInt16LE(0x0201, 0) // RES_TABLE_TYPE
    t.writeUInt16LE(20, 2) // headerSize
    t.writeUInt32LE(32, 4) // size
    t[8] = 1 // type id
    t.writeUInt32LE(0, 12) // entryCount
    t.writeUInt32LE(32, 16) // entriesStart
    t.writeUInt32LE(28, 20) // config size
    t.write(lang.slice(0, 2), 28, 'latin1')
    if (country) t.write(country.slice(0, 2), 30, 'latin1')
    types.push(t)
  }
  const body = Buffer.concat(types)
  const pkg = Buffer.alloc(12)
  pkg.writeUInt16LE(0x0200, 0) // RES_TABLE_PACKAGE
  pkg.writeUInt16LE(12, 2) // headerSize (body starts right after)
  pkg.writeUInt32LE(12 + body.length, 4)
  const head = Buffer.alloc(12)
  head.writeUInt16LE(0x0002, 0) // RES_TABLE_TYPE (table)
  head.writeUInt16LE(12, 2)
  head.writeUInt32LE(12 + pkg.length + body.length, 4)
  return Buffer.concat([head, pkg, body])
}
