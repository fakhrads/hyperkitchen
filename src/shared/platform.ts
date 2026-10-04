import type { PlatformKey } from './types'

/** Map Node's platform/arch pair to our bin dir name, or null if unsupported. */
export function platformKey(platform: string, arch: string): PlatformKey | null {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  return null
}
