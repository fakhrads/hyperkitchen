import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type HkApi } from '../shared/ipc'
import type { JobLogLine, JobState } from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: HkApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  dialog: {
    pickDir: (title) => ipcRenderer.invoke(IPC.dialogPickDir, title),
    pickFile: (title, extensions) => ipcRenderer.invoke(IPC.dialogPickFile, title, extensions)
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    create: (name) => ipcRenderer.invoke(IPC.projectsCreate, name),
    open: (path) => ipcRenderer.invoke(IPC.projectsOpen, path),
    forget: (path) => ipcRenderer.invoke(IPC.projectsForget, path)
  },
  stock: {
    info: (p) => ipcRenderer.invoke(IPC.stockInfo, p),
    inventory: (p) => ipcRenderer.invoke(IPC.stockInventory, p),
    listDir: (p, rel) => ipcRenderer.invoke(IPC.stockListDir, p, rel)
  },
  recipe: {
    get: (p) => ipcRenderer.invoke(IPC.recipeGet, p),
    save: (p, r) => ipcRenderer.invoke(IPC.recipeSave, p, r),
    catalog: () => ipcRenderer.invoke(IPC.recipeCatalog)
  },
  builds: {
    list: (p) => ipcRenderer.invoke(IPC.buildsList, p),
    reveal: (p, id) => ipcRenderer.invoke(IPC.buildsReveal, p, id)
  },
  mods: {
    list: (p) => ipcRenderer.invoke(IPC.modsList, p),
    listDir: (p, id, rel) => ipcRenderer.invoke(IPC.modsListDir, p, id, rel),
    read: (p, id, rel) => ipcRenderer.invoke(IPC.modsRead, p, id, rel),
    write: (p, id, rel, text) => ipcRenderer.invoke(IPC.modsWrite, p, id, rel, text),
    revert: (p, id, rel) => ipcRenderer.invoke(IPC.modsRevert, p, id, rel),
    remove: (p, id, rel) => ipcRenderer.invoke(IPC.modsDelete, p, id, rel),
    methods: (p, id, rel) => ipcRenderer.invoke(IPC.modsMethods, p, id, rel),
    stub: (p, id, rel, sig, value) => ipcRenderer.invoke(IPC.modsStub, p, id, rel, sig, value),
    stringLocales: (p, id) => ipcRenderer.invoke(IPC.modsStringLocales, p, id),
    strings: (p, id, values) => ipcRenderer.invoke(IPC.modsStrings, p, id, values),
    setString: (p, id, values, name, value) =>
      ipcRenderer.invoke(IPC.modsSetString, p, id, values, name, value),
    reveal: (p, id, which) => ipcRenderer.invoke(IPC.modsReveal, p, id, which)
  },
  jobs: {
    list: () => ipcRenderer.invoke(IPC.jobsList),
    start: (kind, params) => ipcRenderer.invoke(IPC.jobsStart, kind, params),
    cancel: (id) => ipcRenderer.invoke(IPC.jobsCancel, id),
    log: (id) => ipcRenderer.invoke(IPC.jobsLog, id),
    onUpdate: (cb) => subscribe<JobState>(IPC.evJobUpdate, cb),
    onLog: (cb) => subscribe<JobLogLine>(IPC.evJobLog, cb)
  },
  doctor: {
    last: () => ipcRenderer.invoke(IPC.doctorLast)
  }
}

contextBridge.exposeInMainWorld('hk', api)
