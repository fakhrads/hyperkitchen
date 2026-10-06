// Smoke test: launches the real app (dev build in out/, or a packaged binary
// via HK_E2E_EXECUTABLE) with isolated user data, then exercises the doctor,
// project creation and the job runner end to end.
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { platformKey } from '../../src/shared/platform'
import { buildFastbootRom } from '../fixtures/rom'

const root = resolve(__dirname, '../..')
let app: ElectronApplication
let page: Page
let tmp: string

test.beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'hk-e2e-'))
  const exe = process.env.HK_E2E_EXECUTABLE
  // Linux CI runners restrict unprivileged user namespaces, which the Chromium
  // sandbox needs. The flag only affects this test launch.
  const extra = process.platform === 'linux' ? ['--no-sandbox'] : []
  app = await electron.launch({
    ...(exe ? { executablePath: exe, args: extra } : { args: [root, ...extra] }),
    env: {
      ...process.env,
      HK_USER_DATA: join(tmp, 'userdata'),
      HK_PROJECTS_ROOT: join(tmp, 'projects')
    }
  })
  page = await app.firstWindow()
  await expect(page).toHaveTitle('HyperKitchen')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(tmp, { recursive: true, force: true })
})

test('doctor finds every bundled binary', async () => {
  await page.getByTestId('nav-doctor').click()
  // The doctor runs automatically at launch; wait for its report.
  const manifest = JSON.parse(readFileSync(join(root, 'resources/bin/manifest.json'), 'utf8')) as {
    tools: Array<{ id: string; kind: string }>
  }
  for (const t of manifest.tools.filter((x) => x.kind === 'native')) {
    await expect(page.getByTestId(`check-bin:${t.id}`)).toHaveAttribute('data-status', 'ok', {
      timeout: 60_000
    })
  }
  await expect(page.getByTestId('check-host:platform')).toHaveAttribute('data-status', 'ok')
  // Java is ok when installed, warn (with an install button) when not; never an error.
  await expect(page.getByTestId('check-java')).toHaveAttribute('data-status', /ok|warn/)
  await page.screenshot({
    path: join(root, 'test-results', `doctor-${process.platform}-${process.arch}.png`),
    fullPage: true
  })
})

test('creates a project on disk and rejects a traversal name', async () => {
  await page.getByTestId('nav-projects').click()
  await page.getByTestId('project-name').fill('../evil')
  await page.getByTestId('project-create').click()
  await expect(page.getByTestId('project-error')).toBeVisible()
  expect(existsSync(join(tmp, 'evil'))).toBe(false)

  await page.getByTestId('project-name').fill('onyx smoke')
  await page.getByTestId('project-create').click()
  await expect(page.getByTestId('project-current')).toContainText('onyx smoke')
  expect(existsSync(join(tmp, 'projects', 'onyx smoke', 'project.json'))).toBe(true)
  expect(existsSync(join(tmp, 'projects', 'onyx smoke', 'recipe.json'))).toBe(true)
})

test('job runner reports progress, completes and cancels', async () => {
  await page.getByTestId('nav-jobs').click()

  await page.getByTestId('selftest-start').click()
  const first = page.getByTestId('job-selftest').first()
  await expect(first).toHaveAttribute('data-status', 'running')
  await first.getByTestId('job-cancel').click()
  await expect(first).toHaveAttribute('data-status', 'cancelled', { timeout: 10_000 })

  await page.getByTestId('selftest-start').click()
  await expect(page.getByTestId('job-selftest').first()).toHaveAttribute('data-status', 'done', {
    timeout: 20_000
  })
})

test('unpacks a ROM folder and shows partitions, files, props and APKs', async () => {
  const binDir = join(root, 'resources/bin', platformKey(process.platform, process.arch) as string)
  const rom = await buildFastbootRom(join(tmp, 'fixture'), binDir)
  // Answer the next native folder dialog with the fixture ROM.
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as never
  }, rom)

  await page.getByTestId('nav-projects').click()
  await page.getByTestId('project-name').fill('onyx unpack')
  await page.getByTestId('project-create').click()
  await page.getByRole('button', { name: 'Choose folder…' }).click()
  await expect(page.getByTestId('unpack-input')).toHaveText(rom)
  await page.getByTestId('unpack-start').click()

  await expect(page.getByTestId('stock-device')).toHaveText('testdev', { timeout: 60_000 })
  await expect(page.getByTestId('stock-version')).toHaveText('TEST.1.0')
  await expect(page.getByTestId('stock-android')).toContainText('16 (API 36)')
  await expect(page.getByTestId('partition-system')).toContainText('system_a')
  await expect(page.getByTestId('partition-vendor')).toContainText('erofs')

  await page.getByTestId('tab-files').click()
  await page.getByTestId('node-vendor').click()
  await page.getByTestId('node-vendor/etc').click()
  await expect(page.getByTestId('node-vendor/etc/fixture.txt')).toBeVisible()

  await page.getByTestId('tab-props').click()
  await page.getByTestId('props-filter').fill('incremental')
  await expect(page.getByTestId('props-table')).toContainText('TEST.1.0')

  await page.getByTestId('tab-apks').click()
  await expect(page.getByTestId('apks-table')).toContainText('com.example.test')
  await expect(page.getByTestId('apks-count')).toHaveText('1 of 1 APKs')
  await page.screenshot({
    path: join(root, 'test-results', `unpack-${process.platform}-${process.arch}.png`),
    fullPage: true
  })
})

test('builds a verified fastboot package from the unpacked ROM', async () => {
  // Continues with the project unpacked by the previous test. The fixture has no vendor_boot,
  // so use the vbmeta-flags verity mode.
  await page.getByTestId('tab-build').click()
  await page.getByTestId('verity-vbmeta').check()
  await page.getByTestId('build-start').click()
  const card = page.locator('[data-testid^="build-2"]').first()
  await expect(card).toHaveAttribute('data-status', 'done', { timeout: 120_000 })
  await expect(card).toContainText('2/2 partitions verified, super.img verified')
  await expect(card).toContainText('vbmeta.img flags 0 -> 3')
  await expect(card).toContainText('macos_install_upgrade.sh')
  await expect(card).toContainText('recovery installer: yes')
  await expect(card).toContainText('zip: hyperkitchen_testdev_TEST.1.0_')
  const builds = join(tmp, 'projects', 'onyx unpack', 'build')
  const id = readdirSync(builds)[0]
  expect(existsSync(join(builds, id, 'images', 'super.img'))).toBe(true)
  expect(existsSync(join(builds, id, 'checksums.sha256'))).toBe(true)
  await page.screenshot({
    path: join(root, 'test-results', `build-${process.platform}-${process.arch}.png`),
    fullPage: true
  })
})

test('debloats an app through the recipe and builds without it', async () => {
  await page.getByTestId('tab-apks').click()
  await page.getByTestId('apks-table').locator('input[type="checkbox"]').first().check()
  await page.getByTestId('apks-debloat').click()
  await expect(page.getByTestId('debloat-list')).toHaveValue('com.example.test')
  await page.getByTestId('recipe-save').click()
  await expect(page.getByTestId('recipe-save')).toBeDisabled()
  const saved = JSON.parse(
    readFileSync(join(tmp, 'projects', 'onyx unpack', 'recipe.json'), 'utf8')
  ) as { operations: Array<{ type: string; params: { packages?: string[] } }> }
  expect(saved.operations).toEqual([
    expect.objectContaining({
      type: 'debloat',
      params: { packages: ['com.example.test'], force: false }
    })
  ])

  await page.getByTestId('tab-build').click()
  await page.getByTestId('verity-vbmeta').check()
  await page.getByTestId('build-start').click()
  const builds = page.locator('[data-testid^="build-2"][data-status="done"]')
  await expect(builds).toHaveCount(2, { timeout: 120_000 })
  const work = join(tmp, 'projects', 'onyx unpack', 'work', 'fs', 'system', 'system', 'app', 'Test')
  expect(existsSync(work)).toBe(false)
})

test('opens the app editor from the APK list', async () => {
  // The fixture APK has no dex or resources to decode; this checks the tab and the picker.
  await page.getByTestId('tab-apps').click()
  await expect(page.getByTestId('mod-target')).toContainText('com.example.test')
  await page.getByTestId('mod-filter').fill('no-such-app')
  await expect(page.getByTestId('mod-target')).not.toContainText('com.example.test')
  await expect(page.getByTestId('mod-create')).toBeDisabled()
})

test('edits the recipe as JSON and reorders operations', async () => {
  await page.getByTestId('tab-recipe').click()
  await page.getByTestId('section-operations').click()
  await page.getByTestId('recipe-edit-json').click()
  const recipe = {
    schema: 1,
    operations: [
      {
        id: 'a-remove',
        type: 'remove-paths',
        enabled: true,
        params: { paths: ['product/app/Foo'] }
      },
      {
        id: 'b-props',
        type: 'set-props',
        enabled: true,
        params: { file: 'product/etc/build.prop', set: { 'ro.x': '1' }, remove: [] }
      }
    ]
  }
  await page.getByTestId('recipe-json').fill(JSON.stringify(recipe))
  await page.getByTestId('recipe-json-apply').click()
  await expect(page.getByTestId('recipe-ops')).toContainText('a-remove')
  await expect(page.getByTestId('recipe-ops')).toContainText('b-props')
  // Reorder: move the second op up, then it must appear before the first.
  await page.getByTestId('op-up-b-props').click()
  const firstId = page.getByTestId('recipe-ops').locator('tbody tr').first()
  await expect(firstId).toContainText('b-props')
  // Invalid JSON is refused with a message, recipe unchanged.
  await page.getByTestId('recipe-edit-json').click()
  await page.getByTestId('recipe-json').fill('{ not json')
  await page.getByTestId('recipe-json-apply').click()
  await expect(page.getByText(/not valid JSON/)).toBeVisible()
})

test('adds an About phone spec card entry through the form', async () => {
  await page.getByTestId('tab-recipe').click()
  await page.getByTestId('section-branding').click()
  await page.getByTestId('speccard-add').click()
  await page.getByTestId('speccard-hwc-0').fill('GL')
  await page.getByTestId('speccard-basic-cpu-0').fill('Snapdragon 8s Gen 4')
  await expect(page.getByTestId('recipe-ops')).toContainText('spec-card')
  await expect(page.getByTestId('recipe-ops')).toContainText('1 region entries')
})

test('toggles a feature tweak into the recipe', async () => {
  await page.getByTestId('tab-recipe').click()
  await page.getByTestId('tweak-disable-ota').check()
  await expect(page.getByTestId('recipe-ops')).toContainText('disable-ota')
})

test('deletes a build from the list', async () => {
  await page.getByTestId('tab-build').click()
  const buildsDir = join(tmp, 'projects', 'onyx unpack', 'build')
  const id = readdirSync(buildsDir)[0]
  expect(existsSync(join(buildsDir, id))).toBe(true)
  page.once('dialog', (d) => void d.accept())
  await page.getByTestId(`build-delete-${id}`).click()
  await expect(page.locator(`[data-testid="build-${id}"]`)).toHaveCount(0)
  expect(existsSync(join(buildsDir, id))).toBe(false)
})
