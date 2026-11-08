/** Pont minimal et typé entre l'interface et le processus principal (contextIsolation). */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getState: () => ipcRenderer.invoke('state:get'),
  getReport: () => ipcRenderer.invoke('report:get'),
  getTokens: () => ipcRenderer.invoke('tokens:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  addManual: (input: unknown) => ipcRenderer.invoke('manual:add', input),
  refresh: () => ipcRenderer.invoke('refresh'),
  openDashboard: (tab?: string) => ipcRenderer.invoke('dashboard:open', tab),
  expand: (v: boolean) => ipcRenderer.invoke('overlay:expand', v),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
  reportHeight: (px: number) => ipcRenderer.invoke('overlay:content-height', px),
  resetPosition: () => ipcRenderer.invoke('overlay:reset-position'),
  dragStart: () => ipcRenderer.invoke('drag:start'),
  dragEnd: () => ipcRenderer.invoke('drag:end'),
  exportData: (format: 'json' | 'csv') => ipcRenderer.invoke('export', format),
  deleteHistory: () => ipcRenderer.invoke('history:delete'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  setAutoStart: (on: boolean) => ipcRenderer.invoke('autostart:set', on),
  openDataDir: () => ipcRenderer.invoke('open:data-dir'),
  on: (channel: 'state' | 'expanded' | 'tab', cb: (v: unknown) => void) => {
    const fn = (_e: unknown, v: unknown) => cb(v);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
};

contextBridge.exposeInMainWorld('guardian', api);
export type GuardianApi = typeof api;
