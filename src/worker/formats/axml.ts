// Android binary XML (AXML) reader, enough to pull attributes out of AndroidManifest.xml.
// Structures from AOSP frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h,
// string length decoding from ResourceTypes.cpp (decodeLength). Little endian throughout.
//
//   ResChunk_header         u16 type, u16 headerSize, u32 size
//   ResStringPool_header    header, u32 stringCount, u32 styleCount, u32 flags (UTF8_FLAG 1<<8),
//                           u32 stringsStart, u32 stylesStart; then u32 offsets[stringCount]
//   ResXMLTree_node         header, u32 lineNumber, u32 comment
//   ResXMLTree_attrExt      u32 ns, u32 name, u16 attributeStart, u16 attributeSize,
//                           u16 attributeCount, u16 idIndex, u16 classIndex, u16 styleIndex
//   ResXMLTree_attribute    u32 ns, u32 name, u32 rawValue, Res_value typedValue
//   Res_value               u16 size, u8 res0, u8 dataType, u32 data

const RES_STRING_POOL_TYPE = 0x0001
const RES_XML_TYPE = 0x0003
const RES_XML_START_ELEMENT_TYPE = 0x0102
const RES_XML_END_ELEMENT_TYPE = 0x0103
const RES_XML_RESOURCE_MAP_TYPE = 0x0180
const UTF8_FLAG = 1 << 8
const NO_INDEX = 0xffffffff

export const TYPE_REFERENCE = 0x01
export const TYPE_STRING = 0x03
export const TYPE_INT_DEC = 0x10
export const TYPE_INT_HEX = 0x11
export const TYPE_INT_BOOLEAN = 0x12

export interface AxmlAttr {
  ns: string | null
  name: string
  /** Android attribute resource id from the resource map, when present. */
  resId: number | null
  raw: string | null
  type: number
  data: number
}

export interface AxmlElement {
  name: string
  depth: number
  attrs: AxmlAttr[]
}

function readStringPool(b: Buffer, off: number): string[] {
  const headerSize = b.readUInt16LE(off + 2)
  const count = b.readUInt32LE(off + 8)
  const flags = b.readUInt32LE(off + 16)
  const stringsStart = b.readUInt32LE(off + 20)
  const utf8 = (flags & UTF8_FLAG) !== 0
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    let p = off + stringsStart + b.readUInt32LE(off + headerSize + i * 4)
    if (utf8) {
      // u8-encoded UTF-16 length, then u8-encoded UTF-8 byte length.
      let n = b[p++]
      if (n & 0x80) p++
      n = b[p++]
      if (n & 0x80) n = ((n & 0x7f) << 8) | b[p++]
      out.push(b.subarray(p, p + n).toString('utf8'))
    } else {
      let n = b.readUInt16LE(p)
      p += 2
      if (n & 0x8000) {
        n = ((n & 0x7fff) << 16) | b.readUInt16LE(p)
        p += 2
      }
      out.push(b.subarray(p, p + n * 2).toString('utf16le'))
    }
  }
  return out
}

/** Every start element in document order, with its attributes. */
export function parseAxml(b: Buffer): AxmlElement[] {
  if (b.length < 8 || b.readUInt16LE(0) !== RES_XML_TYPE) throw new Error('not a binary XML file')
  const end = Math.min(b.length, b.readUInt32LE(4))
  let strings: string[] = []
  let resMap: number[] = []
  const out: AxmlElement[] = []
  let depth = 0
  let p = b.readUInt16LE(2)
  const str = (i: number): string | null => (i === NO_INDEX ? null : (strings[i] ?? null))
  while (p + 8 <= end) {
    const type = b.readUInt16LE(p)
    const headerSize = b.readUInt16LE(p + 2)
    const size = b.readUInt32LE(p + 4)
    if (size < 8 || p + size > end) throw new Error(`bad AXML chunk at ${p}`)
    if (type === RES_STRING_POOL_TYPE) {
      strings = readStringPool(b, p)
    } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      resMap = []
      for (let q = p + headerSize; q + 4 <= p + size; q += 4) resMap.push(b.readUInt32LE(q))
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      const ext = p + headerSize
      const name = str(b.readUInt32LE(ext + 4)) ?? ''
      const attrStart = b.readUInt16LE(ext + 8)
      const attrSize = b.readUInt16LE(ext + 10)
      const attrCount = b.readUInt16LE(ext + 12)
      const attrs: AxmlAttr[] = []
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize
        const nameIdx = b.readUInt32LE(a + 4)
        attrs.push({
          ns: str(b.readUInt32LE(a)),
          name: str(nameIdx) ?? '',
          resId: nameIdx < resMap.length ? resMap[nameIdx] : null,
          raw: str(b.readUInt32LE(a + 8)),
          type: b[a + 15],
          data: b.readUInt32LE(a + 16)
        })
      }
      out.push({ name, depth, attrs })
      depth++
    } else if (type === RES_XML_END_ELEMENT_TYPE) {
      depth--
    }
    p += size
  }
  return out
}

const ATTR_VERSION_CODE = 0x0101021b
const ATTR_VERSION_NAME = 0x0101021c
const ATTR_VERSION_CODE_MAJOR = 0x01010576
const ATTR_SHARED_USER_ID = 0x0101000b
const ATTR_MIN_SDK = 0x0101020c
const ATTR_TARGET_SDK = 0x01010270

export interface ManifestInfo {
  packageName: string | null
  versionCode: number | null
  versionName: string | null
  sharedUserId: string | null
  /** Names of <uses-library> entries, needed by the debloat dependency check (M4). */
  usesLibraries: string[]
  /** Target package when this APK is a runtime resource overlay. */
  overlayTarget: string | null
  /** uses-sdk minSdkVersion / targetSdkVersion as integers, when present. */
  minSdk: number | null
  targetSdk: number | null
}

/** String form of an attribute. Unresolved resource references are shown as @0x7f...... */
function attrText(a: AxmlAttr): string | null {
  if (a.type === TYPE_STRING) return a.raw
  if (a.type === TYPE_INT_DEC) return String(a.data | 0)
  if (a.type === TYPE_INT_HEX) return `0x${a.data.toString(16)}`
  if (a.type === TYPE_REFERENCE) return `@0x${a.data.toString(16).padStart(8, '0')}`
  return a.raw
}

function find(attrs: AxmlAttr[], resId: number, name: string): AxmlAttr | undefined {
  // Prefer the resource id: some build tools strip attribute names but keep the map.
  return attrs.find((a) => a.resId === resId) ?? attrs.find((a) => a.name === name)
}

export function readManifest(b: Buffer): ManifestInfo {
  const els = parseAxml(b)
  const m = els.find((e) => e.name === 'manifest' && e.depth === 0)
  if (!m) throw new Error('no <manifest> element')
  const pkg = m.attrs.find((a) => a.name === 'package' && !a.ns)
  const vc = find(m.attrs, ATTR_VERSION_CODE, 'versionCode')
  const vcMajor = find(m.attrs, ATTR_VERSION_CODE_MAJOR, 'versionCodeMajor')
  const vn = find(m.attrs, ATTR_VERSION_NAME, 'versionName')
  const su = find(m.attrs, ATTR_SHARED_USER_ID, 'sharedUserId')
  let versionCode: number | null = null
  if (vc) {
    const lo = vc.type === TYPE_STRING ? Number(vc.raw) : vc.data >>> 0
    const hi = vcMajor ? vcMajor.data >>> 0 : 0
    versionCode = hi * 2 ** 32 + lo
  }
  const overlay = els.find((e) => e.name === 'overlay' && e.depth === 1)
  const usesSdk = els.find((e) => e.name === 'uses-sdk' && e.depth === 1)
  const sdkInt = (resId: number, name: string): number | null => {
    if (!usesSdk) return null
    const a = find(usesSdk.attrs, resId, name)
    if (!a) return null
    const n = a.type === TYPE_STRING ? Number(a.raw) : a.data | 0
    return Number.isFinite(n) ? n : null
  }
  return {
    packageName: pkg ? (pkg.raw ?? null) : null,
    versionCode,
    versionName: vn ? attrText(vn) : null,
    sharedUserId: su?.raw ?? null,
    usesLibraries: els
      .filter((e) => e.name === 'uses-library' || e.name === 'uses-native-library')
      .map((e) => e.attrs.find((a) => a.name === 'name')?.raw ?? '')
      .filter(Boolean),
    overlayTarget: overlay?.attrs.find((a) => a.name === 'targetPackage')?.raw ?? null,
    minSdk: sdkInt(ATTR_MIN_SDK, 'minSdkVersion'),
    targetSdk: sdkInt(ATTR_TARGET_SDK, 'targetSdkVersion')
  }
}
