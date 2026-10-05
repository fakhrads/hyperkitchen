// Privileged permission allowlist check on extracted trees. Not part of `pnpm test`:
//   HK_FS=<project>/stock/fs npx vitest run --config tests/local/vitest.config.ts tests/local/privapp.local.test.ts
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { checkPrivapp } from '../../src/worker/privapp'

it('checks privapp allowlists', async () => {
  const fs = process.env.HK_FS as string
  const parts = readdirSync(fs).filter((n) => n !== 'config')
  const r = await checkPrivapp(fs, parts)
  if (!r) throw new Error('no framework-res.apk')
  const lines = [
    `modes=${r.modes.join(',')} enforced=${r.enforced} privileged=${r.privilegedPermissions} apps=${r.appsChecked} violations=${r.violations.length}`,
    ...r.violations.map((v) => `${v.scope} ${v.packageName} ${v.apk} ${v.permission}`)
  ]
  writeFileSync(join(fs, '..', 'privapp-check.txt'), lines.join('\n') + '\n')
})
