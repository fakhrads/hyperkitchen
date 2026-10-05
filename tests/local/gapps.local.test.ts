// GApps operation on a real ROM tree, followed by the privapp allowlist check. Not part of
// `pnpm test`:
//   HK_PROJECT_DIR=<project> HK_GAPPS_ZIP=<MindTheGapps zip> HK_SCRATCH=<dir> \
//     npx vitest run --config tests/local/vitest.config.ts tests/local/gapps.local.test.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { Recipe } from '../../src/shared/recipe'
import type { Inventory, StockInfo } from '../../src/shared/types'
import { cloneTree } from '../../src/worker/fsutil'
import { checkPrivapp } from '../../src/worker/privapp'
import { applyRecipe } from '../../src/worker/recipe/apply'

const project = process.env.HK_PROJECT_DIR as string
const scratch = process.env.HK_SCRATCH as string

it('adds MindTheGapps and passes the privapp check', async () => {
  const stock = JSON.parse(readFileSync(join(project, 'stock/stock.json'), 'utf8')) as StockInfo
  const inv = JSON.parse(readFileSync(join(project, 'stock/inventory.json'), 'utf8')) as Inventory
  const partitions = stock.partitions.filter((p) => p.extracted).map((p) => p.name)
  const fs = join(scratch, 'fs')
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  await cloneTree(join(project, 'stock/fs'), fs)
  const recipe: Recipe = JSON.parse(process.env.HK_RECIPE ?? 'null') ?? {
    schema: 1,
    operations: [
      { id: 'cn', type: 'unlock-cn-gms', enabled: true, params: { includeGnss: false } },
      {
        id: 'mtg',
        type: 'gapps',
        enabled: true,
        params: {
          zip: process.env.HK_GAPPS_ZIP as string,
          exclude: ['VelvetTitan', 'SetupWizard', 'GmsSetupWizardOverlay.apk'],
          replaceDifferentSigner: true
        }
      }
    ]
  }
  const lines: string[] = []
  const reports = await applyRecipe(recipe, {
    projectPath: project,
    workFs: fs,
    partitions,
    apks: inv.apks,
    stockVersion: stock.romVersion,
    java: null,
    apktool: '',
    tmp: join(scratch, 'tmp'),
    signal: new AbortController().signal,
    log: (s) => void lines.push(s),
    progress: () => {}
  })
  const pa = await checkPrivapp(fs, partitions)
  lines.push(JSON.stringify(reports, null, 1))
  lines.push(
    `privapp: enforced=${pa?.enforced} apps=${pa?.appsChecked} violations=${pa?.violations.length}`
  )
  for (const v of pa?.violations ?? [])
    lines.push(`  ${v.scope} ${v.packageName} ${v.apk} ${v.permission}`)
  writeFileSync(join(scratch, 'gapps-test.log'), lines.join('\n') + '\n')
  expect(pa?.violations).toEqual([])
})
