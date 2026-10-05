// Signer certificate of an APK, without a JVM.
//
// APK Signing Block (apksig ApkSigningBlockUtils / ApkSigningBlockUtilsLite), immediately
// before the ZIP central directory:
//   u64 size (excluding this field) | repeated { u64 len, u32 id, value } | u64 size | "APK Sig Block 42"
// Scheme block ids (V2SchemeConstants / V3SchemeConstants): v2 0x7109871a, v3 0xf05368c0,
// v3.1 0x1b93ad61. Inside: length-prefixed (u32 LE) sequence of signers; each signer starts
// with length-prefixed signed data, which starts with length-prefixed digests followed by
// length-prefixed certificates (a sequence of length-prefixed X.509 DER blobs).
//
// v1 (JAR) fallback: META-INF/*.RSA|DSA|EC is a PKCS#7 ContentInfo wrapping SignedData
// (RFC 5652 5.1); certificates is the [0] IMPLICIT field after encapContentInfo.

import { createHash } from 'node:crypto'
import type { ZipFile } from './zip'

const MAGIC = Buffer.from('APK Sig Block 42', 'latin1')
export const V2_ID = 0x7109871a
export const V3_ID = 0xf05368c0
export const V31_ID = 0x1b93ad61

export interface SignerInfo {
  /** Schemes present: 'v1', 'v2', 'v3', 'v3.1'. */
  schemes: string[]
  /** SHA-256 of the first signer certificate (DER), lowercase hex. */
  certSha256: string | null
}

function lp(b: Buffer, p: { o: number }): Buffer {
  if (p.o + 4 > b.length) throw new Error('length-prefixed field truncated')
  const n = b.readUInt32LE(p.o)
  p.o += 4
  if (p.o + n > b.length) throw new Error('length-prefixed field out of range')
  const s = b.subarray(p.o, p.o + n)
  p.o += n
  return s
}

/** First certificate of the first signer in a v2/v3/v3.1 scheme block. */
export function firstSchemeCert(block: Buffer): Buffer | null {
  const signers = lp(block, { o: 0 })
  if (signers.length === 0) return null
  const signer = lp(signers, { o: 0 })
  const signedData = lp(signer, { o: 0 })
  const q = { o: 0 }
  lp(signedData, q) // digests
  const certs = lp(signedData, q)
  if (certs.length === 0) return null
  return Buffer.from(lp(certs, { o: 0 }))
}

/** Map of scheme block id to value, or null when the APK has no signing block. */
export async function readSigningBlock(zip: ZipFile): Promise<Map<number, Buffer> | null> {
  const cd = zip.index.centralDirOffset
  if (cd < 32) return null
  const footer = await zip.readRange(cd - 24, 24)
  if (!footer.subarray(8).equals(MAGIC)) return null
  const size = Number(footer.readBigUInt64LE(0))
  const start = cd - size - 8
  if (start < 0) throw new Error('APK signing block size out of range')
  const block = await zip.readRange(start, size + 8)
  if (Number(block.readBigUInt64LE(0)) !== size) throw new Error('APK signing block sizes differ')
  const pairs = block.subarray(8, block.length - 24)
  const out = new Map<number, Buffer>()
  let o = 0
  while (o + 12 <= pairs.length) {
    const len = Number(pairs.readBigUInt64LE(o))
    if (len < 4 || o + 8 + len > pairs.length)
      throw new Error('APK signing block pair out of range')
    out.set(pairs.readUInt32LE(o + 8), pairs.subarray(o + 12, o + 8 + len))
    o += 8 + len
  }
  return out
}

// --- minimal DER walker for the v1 PKCS#7 fallback

interface Tlv {
  tag: number
  start: number
  headerLen: number
  len: number
}

function tlv(b: Buffer, o: number): Tlv {
  const tag = b[o]
  let len = b[o + 1]
  let headerLen = 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) throw new Error('unsupported DER length')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + b[o + 2 + i]
    headerLen += n
  }
  if (o + headerLen + len > b.length) throw new Error('DER element out of range')
  return { tag, start: o, headerLen, len }
}

function children(b: Buffer, parent: Tlv): Tlv[] {
  const out: Tlv[] = []
  let o = parent.start + parent.headerLen
  const end = o + parent.len
  while (o < end) {
    const t = tlv(b, o)
    out.push(t)
    o = t.start + t.headerLen + t.len
  }
  return out
}

/** First certificate in a PKCS#7 SignedData blob, as DER. */
export function firstPkcs7Cert(b: Buffer): Buffer | null {
  const ci = tlv(b, 0)
  if (ci.tag !== 0x30) throw new Error('PKCS#7: not a SEQUENCE')
  const [, explicit] = children(b, ci)
  if (!explicit || explicit.tag !== 0xa0) throw new Error('PKCS#7: no content')
  const [sd] = children(b, explicit)
  if (!sd || sd.tag !== 0x30) throw new Error('PKCS#7: bad SignedData')
  // version, digestAlgorithms, encapContentInfo, then optional [0] certificates.
  const certSet = children(b, sd).find((t, i) => i >= 3 && t.tag === 0xa0)
  if (!certSet) return null
  const [cert] = children(b, certSet)
  return cert ? Buffer.from(b.subarray(cert.start, cert.start + cert.headerLen + cert.len)) : null
}

const sha256hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

export async function readSigner(zip: ZipFile): Promise<SignerInfo> {
  const schemes: string[] = []
  let cert: Buffer | null = null
  const v1 = [...zip.entries.keys()].find((n) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(n))
  if (v1) schemes.push('v1')
  const block = await readSigningBlock(zip)
  if (block) {
    for (const [id, label] of [
      [V2_ID, 'v2'],
      [V3_ID, 'v3'],
      [V31_ID, 'v3.1']
    ] as const) {
      if (block.has(id)) schemes.push(label)
    }
    // Prefer v3, then v2, then v3.1, so a v3.1 key rotation does not change the reported
    // signer between builds of the same app.
    for (const id of [V3_ID, V2_ID, V31_ID]) {
      const v = block.get(id)
      if (v && !cert) cert = firstSchemeCert(v)
    }
  }
  if (!cert && v1) {
    const data = await zip.read(v1)
    if (data) cert = firstPkcs7Cert(data)
  }
  return { schemes, certSha256: cert ? sha256hex(cert) : null }
}
