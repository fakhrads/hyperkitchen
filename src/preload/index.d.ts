import type { HkApi } from '../shared/ipc'

declare global {
  interface Window {
    hk: HkApi
  }
}
