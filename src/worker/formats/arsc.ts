// Minimal resources.arsc reader: the locales a compiled resource table carries.
//
// Layout from AOSP ResourceTypes.h: RES_TABLE_TYPE (0x0002) holds a global string pool and
// RES_TABLE_PACKAGE (0x0200) chunks; each package holds RES_TABLE_TYPE_TYPE (0x0201) chunks,
// each with a ResTable_config. The config's language (offset +8) and country (+10) are two
// bytes each, either two ASCII letters or a high-bit-packed BCP-47 code (ResTable_config
// unpackLanguageOrRegion). Locale "any" (0,0) is the default configuration.

const RES_TABLE = 0x0002
const RES_PACKAGE = 0x0200
const RES_TYPE = 0x0201

/** Two config bytes to a 2- or 3-letter code, or '' for "any". */
function unpack(a: number, b: number): string {
  if (a === 0 && b === 0) return ''
  if (a & 0x80) {
    // Packed three letters, 5 bits each, base 'a'.
    const first = b & 0x1f
    const second = ((b & 0xe0) >> 5) | ((a & 0x03) << 3)
    const third = (a & 0x7c) >> 2
    return String.fromCharCode(0x60 + first, 0x60 + second, 0x60 + third)
  }
  return String.fromCharCode(a, b)
}

/** Unique locale tags (e.g. "en", "zh-CN") declared anywhere in the table. */
export function arscLocales(arsc: Buffer): string[] {
  const out = new Set<string>()
  const walk = (start: number, end: number): void => {
    let p = start
    while (p + 8 <= end) {
      const type = arsc.readUInt16LE(p)
      const headerSize = arsc.readUInt16LE(p + 2)
      const size = arsc.readUInt32LE(p + 4)
      if (size < 8 || p + size > end) break
      if (type === RES_TABLE || type === RES_PACKAGE) {
        walk(p + headerSize, p + size)
      } else if (type === RES_TYPE && p + 32 <= end) {
        // body: id(1) flags(1) reserved(2) entryCount(4) entriesStart(4) then ResTable_config
        const cfg = p + 20
        const lang = unpack(arsc[cfg + 8], arsc[cfg + 9])
        const country = unpack(arsc[cfg + 10], arsc[cfg + 11])
        if (lang) out.add(country ? `${lang}-${country}` : lang)
      }
      p += size
    }
  }
  if (arsc.length >= 12 && arsc.readUInt16LE(0) === RES_TABLE) walk(0, arsc.length)
  return [...out].sort()
}
