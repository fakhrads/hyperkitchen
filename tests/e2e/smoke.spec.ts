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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
