import { app } from 'electron';
import { createMainWindow } from './windows.js';
import { registerIpcHandlers } from './ipc.js';

let nativeStatus: { loaded: boolean; message: string } = {
  loaded: false,
  message: 'not attempted',
};

try {
  const native = require('@agivar/native');
  const result = native.ping();
  nativeStatus = { loaded: true, message: result };
  console.log('[main] native addon loaded:', result);
} catch (err: any) {
  nativeStatus = { loaded: false, message: err.message };
  console.error('[main] native addon failed:', err.message);
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

export { nativeStatus };
