import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agivar', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  screenshot: {
    captureScreen: (idx?: number) => ipcRenderer.invoke('screenshot:captureScreen', idx),
    getActiveWindow: () => ipcRenderer.invoke('screenshot:getActiveWindow'),
    listWindows: () => ipcRenderer.invoke('screenshot:listWindows'),
  },
  uia: {
    getUiTree: (hwnd: number, opts?: any) => ipcRenderer.invoke('uia:getUiTree', hwnd, opts),
    findElement: (hwnd: number, q: any, opts?: any) => ipcRenderer.invoke('uia:findElement', hwnd, q, opts),
  },
  input: {
    click: (x: number, y: number, opts?: any) => ipcRenderer.invoke('input:click', x, y, opts),
    typeText: (text: string) => ipcRenderer.invoke('input:typeText', text),
    pressKeys: (keys: string[]) => ipcRenderer.invoke('input:pressKeys', keys),
  },
  browser: {
    launch: (opts?: any) => ipcRenderer.invoke('browser:launch', opts),
  },
  recorder: {
    start: (config: any) => ipcRenderer.invoke('recorder:start', config),
    stop: (sid: string) => ipcRenderer.invoke('recorder:stop', sid),
    forceStopAll: () => ipcRenderer.invoke('recorder:forceStopAll'),
  },
  dpi: {
    getScaleFactor: (idx?: number) => ipcRenderer.invoke('dpi:getScaleFactor', idx),
  },
});
