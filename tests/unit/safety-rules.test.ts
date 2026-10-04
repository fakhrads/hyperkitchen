// Enforces the hard safety rules from PLAN.md at the source level: the app
// never drives a device and never formats or partitions a host disk.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = resolve(__dirname, '../../src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js)$/.test(n) ? [p] : []
  })
}

// A command name used as a string literal is how spawn/run would be called.
const FORBIDDEN =
  /['"`](fastboot|adb|dd|diskutil|fdisk|parted|sgdisk|mkfs\.(ext4|vfat|fat|apfs|hfs)|wipefs|blkdiscard)['"`]/

describe('safety rules', () => {
  it('no source file names a device or disk-formatting command as a string literal', () => {
    const offenders = walk(srcRoot).filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('no source file spawns through a shell', () => {
    const offenders = walk(srcRoot).filter((f) =>
      /shell:\s*true|\bexecSync\(|\bexec\(/.test(readFileSync(f, 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})
