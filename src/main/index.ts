import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { z } from 'zod'
import workerPath from '../worker/index?modulePath'
import icon from '../../resources/icon.png?asset'
import { IPC } from '../shared/ipc'
import type { AppInfo, DoctorReport, JobState, Settings } from '../shared/types'
import type { WorkerToMain } from '../shared/worker-protocol'
import { JobManager, type WorkerLike } from './jobs'
import { binDir, commonBinDir, currentPlatformKey, managedJreDir, manifestPath } from './paths'
import { createProject, listProjects, openProject } from './projects'
import { SettingsPatchSchema, SettingsStore } from './settings'

// Test hooks: isolate user data and the default projects folder.
if (process.env.HK_USER_DATA) app.setPath('userData', process.env.HK_USER_DATA)

const settings = new SettingsStore(
  join(app.getPath('userData'), 'settings.json'),
  (): Settings => ({
    schema: 1,
    projectsRoot:
      process.env.HK_PROJECTS_ROOT ?? join(app.getPath('home'), 'HyperKitchen', 'projects'),
    javaPath: '',
    recentProjects: []
  })
)

let mainWindow: BrowserWindow | null = null
let lastDoctor: DoctorReport | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

const jobs = new JobManager(
  () => {
    const child = utilityProcess.fork(workerPath, [], { serviceName: 'HyperKitchen job runner' })
    return {
      postMessage: (m) => child.postMessage(m),
      on: (ev: 'message' | 'exit', cb: (arg: never) => void) => {
        if (ev === 'message')
          child.on('message', (m: WorkerToMain) => (cb as (m: WorkerToMain) => void)(m))
        else child.on('exit', (code: number) => (cb as (c: number) => void)(code))
      },
      kill: () => child.kill()
    } as WorkerLike
  },
  async () => {
    const s = await settings.get()
    return {
      platform: process.platform,
      arch: process.arch,
      binDir: binDir(),
      commonBinDir: commonBinDir(),
      manifestPath: manifestPath(),
      userData: app.getPath('userData'),
      managedJreDir: managedJreDir(),
      projectsRoot: s.projectsRoot,
      javaPathSetting: s.javaPath
    }
  },
  {
    onUpdate: (job: JobState) => {
      if (job.kind === 'doctor' && job.status === 'done') lastDoctor = job.result as DoctorReport
      broadcast(IPC.evJobUpdate, job)
    },
    onLog: (line) => broadcast(IPC.evJobLog, line)
  }
)

async function rememberProject(path: string): Promise<void> {
  const s = await settings.get()
  await settings.update({
    recentProjects: [path, ...s.recentProjects.filter((p) => p !== path)].slice(0, 20)
  })
}

const JobStartSchema = z.object({
  kind: z.enum(['selftest', 'doctor', 'java-install', 'clear-quarantine']),
  params: z.record(z.string(), z.unknown()).default({})
})

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    platformKey: currentPlatformKey(),
    userData: app.getPath('userData'),
    binDir: binDir(),
    commonBinDir: commonBinDir(),
    packaged: app.isPackaged
  }))

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: unknown) =>
    settings.update(SettingsPatchSchema.parse(patch))
  )

  ipcMain.handle(IPC.dialogPickDir, async (_e, title: unknown) => {
    const opts = {
      title: String(title ?? 'Choose folder'),
      properties: ['openDirectory', 'createDirectory'] as const
    }
    const r = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { ...opts, properties: [...opts.properties] })
      : await dialog.showOpenDialog({ ...opts, properties: [...opts.properties] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.projectsList, async () => listProjects((await settings.get()).recentProjects))
  ipcMain.handle(IPC.projectsCreate, async (_e, name: unknown) => {
    const p = await createProject((await settings.get()).projectsRoot, z.string().parse(name))
    await rememberProject(p.path)
    return p
  })
  ipcMain.handle(IPC.projectsOpen, async (_e, path: unknown) => {
    const p = await openProject(z.string().min(1).parse(path))
    await rememberProject(p.path)
    return p
  })
  ipcMain.handle(IPC.projectsForget, async (_e, path: unknown) => {
    const target = z.string().parse(path)
    const s = await settings.get()
    // Only removes the entry from the recent list. Never deletes files.
    await settings.update({ recentProjects: s.recentProjects.filter((p) => p !== target) })
  })

  ipcMain.handle(IPC.jobsList, () => jobs.list())
  ipcMain.handle(IPC.jobsStart, (_e, kind: unknown, params: unknown) => {
    const parsed = JobStartSchema.parse({ kind, params: params ?? {} })
    return jobs.start(parsed.kind, parsed.params)
  })
  ipcMain.handle(IPC.jobsCancel, (_e, id: unknown) => jobs.cancel(z.string().parse(id)))
  ipcMain.handle(IPC.jobsLog, (_e, id: unknown) => jobs.log(z.string().parse(id)))
  ipcMain.handle(IPC.doctorLast, () => lastDoctor)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'HyperKitchen',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https:\/\//.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.hyperkitchen.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  createWindow()
  // Run the doctor once at launch so missing binaries show up immediately.
  void jobs.start('doctor')
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => jobs.dispose())
