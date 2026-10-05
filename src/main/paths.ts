import { app } from 'electron'
import { join } from 'node:path'
import { platformKey } from '../shared/platform'
import type { PlatformKey } from '../shared/types'

export function currentPlatformKey(): PlatformKey | null {
  return platformKey(process.platform, process.arch)
}

/** resources/bin in dev, <app>/Contents/Resources/bin (or resources/bin) when packaged. */
export function binRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin')
}

export function binDir(): string | null {
  const key = currentPlatformKey()
  return key ? join(binRoot(), key) : null
}

export function commonBinDir(): string {
  return join(binRoot(), 'common')
}

export function manifestPath(): string {
  return join(binRoot(), 'manifest.json')
}

export function managedJreDir(): string {
  return join(app.getPath('userData'), 'jre')
}

/** The recovery update-binary built from installer/updater (pnpm build-updater). */
export function updaterPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'updater', 'update-binary')
    : join(app.getAppPath(), 'resources', 'updater', 'update-binary')
}
