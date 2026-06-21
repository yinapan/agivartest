import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('agivar', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
